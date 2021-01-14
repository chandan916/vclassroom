const express = require("express");
const { pool } = require("./dbConfig");
const bcrypt = require("bcrypt");
const passport = require("passport");
const flash = require("express-flash");
const session = require("express-session");
require("dotenv").config();
const multer = require('multer');
const AWS = require('aws-sdk');
const { v4: uuid } = require('uuid');
const app = express();
const cryptoRandomString = require('crypto-random-string');


const PORT = process.env.PORT || 3000;

const SESConfig = {
  apiVersion: "2010-12-01",
  accessKeyId: process.env.AWS_ID,
  accessSecretKey: process.env.AWS_SECRET,
  region: process.env.AWS_SES_REGION
};
AWS.config.update(SESConfig);

var ses = new AWS.SES();


const initializePassport = require("./passportConfig");

initializePassport(passport);

app.use(express.urlencoded({ extended: false }));
app.set("view engine", "ejs");

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/users/register", checkAuthenticated, (req, res) => {
  res.render("register.ejs");
});

app.get("/users/login", checkAuthenticated, (req, res) => {
  // flash sets a messages variable. passport sets the error message
  console.log(req.session.flash.error);
  res.render("login.ejs");
});

app.post(
  "/users/login",
  passport.authenticate("local", {
    successRedirect: "/users/home",
    failureRedirect: "/users/login",
    failureFlash: true
  })
);

app.get("/users/logout", (req, res) => {
  req.logout();
  res.render("index", { message: "You have logged out successfully" });
});

function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect("/users/home");
  }
  next();
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/users/login");
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


app.post("/users/register", async (req, res) => {
  let { name, email, password, password2 } = req.body;

  let errors = [];

  if (!name || !email || !password || !password2) {
    errors.push({ message: "Please enter all fields" });
  }

  if (password.length < 6) {
    errors.push({ message: "Password must be a least 6 characters long" });
  }

  if (password !== password2) {
    errors.push({ message: "Passwords do not match" });
  }

  if (errors.length > 0) {
    res.render("register", { errors, name, email, password, password2 });
  } else {
    hashedPassword = await bcrypt.hash(password, 10);
    // Validation passed
    pool.query(
      `SELECT * FROM users
        WHERE email = $1`,
      [email],
      (err, results) => {
        if (err) {
          console.log(err.message);
        }

        if (results.rows.length > 0) {
          return res.render("register", {
            message: "Email already registered"
          });
        } else {
          let r=cryptoRandomString({length: 10, characters: 'abcdefgh'});
          pool.query(
            `INSERT INTO users (name, email, password,userid,userinfo)
                VALUES ($1, $2, $3,$4, '{
                  "cclassid":[],
                  "jclassid":[]
                }')
                RETURNING id, password`,
            [name, email, hashedPassword,r],
            (err, results) => {
              if (err) {
                throw err;
              }
              console.log(results.rows);
              req.flash("success_msg", "You are now registered. Please log in");    
              res.redirect("/users/login");          
            }
          );
        }
      }
    );
  }
});

app.get('/verify',(req,res)=>{
  let email=req.user.email;
  var params = {
    EmailAddress: email
};
ses.verifyEmailIdentity(params, function(err, data) {
  if(err) {
      console.log(err);
      req.flash("verify","E-mail id does not exist");
      res.redirect('/users/home');
  } 
  else {
      console.log(data);
      req.flash("verify","A verification mail has been sent to your E-mail");
      res.redirect('/users/home');
  } 
   });
  
});


const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ID,
  secretAccessKey: process.env.AWS_SECRET
})

const storage = multer.memoryStorage({
  destination: function(req, file, callback) {
      callback(null, '')
  }
})

const upload = multer({storage}).single('assignment');

app.post('/uploadassignment/:classid/:classing',upload,(req, res) => {
  let classid=req.params.classid;
  let description=req.params.classing;
  let myFile = req.file.originalname.split(".");
  const fileType = myFile[myFile.length - 1];

  const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `${uuid()}.${fileType}`,
      Body: req.file.buffer
  };

  s3.upload(params, (error, data) => {
      if(error){
          res.status(500).send(error)
      }
      if(data){
        let msg;
        let p=`select userid from users where email='${req.user.email}'`;
        const temp4=pool.query(p,(err,res)=>{
          if(err){console.log(err.message);}
          if(res){console.log(res);
            console.log("res is:",res.rows[0].userid);
          }
        let v=`update 
        classtable m 
        set classinfo = 
        jsonb_set(
           m.classinfo::jsonb, 
           array['studentinfo',(pos1-1)::text,'assingment',999::text],
           '{"desc":"${description}","url":"${data.Location}"}'::jsonb 
        )::json
        from classtable l
        cross join jsonb_array_elements(l.classinfo->'studentinfo') with ordinality arr1(elems, pos1)
        where (elems->>'id')::text = '${res.rows[0].userid}' and m.classid='${classid}'`;
        const temp=pool.query(v,(err,res)=>{
          if(err){console.log("assignment cannot be submited:",err.message);
                  msg=err.message;
                    }
          if(res){console.log("assignment submitted");
                      msg="assignment submitted successfully";
                  }
        });
        });
        
      console.log(data.Location);
      req.flash("msg","assignment submitted");
      res.redirect(`/users/home/jc/jrpage/${classid}`);
      }      
  });
});


app.get("/users/home", checkNotAuthenticated, (req,res)=>{
  const email=req.user.email;
  let uname=req.user.name;
  console.log("resquest for authentication",req.isAuthenticated());
  let temp1=pool.query(`select userinfo->'cclassid'as cclass from users where email=$1`,[email],async (err,results)=>{
    console.log("created classes",results.rows[0].cclass);

        let rstr=`select userinfo->'jclassid' as jclass from users where email=$1`;
        const h= pool.query(rstr,[email],(err,result)=>{
          if(err){console.log("join class display error:",err.message);}
          if(result){
            console.log("joined classes are:",result.rows[0].jclass);
            res.render('home.ejs',{temp:results.rows[0].cclass,jclass:result.rows[0].jclass,uname:uname});
          }
        });
      });
  
});

app.get("/users/home/cc",(req,res)=>{
  res.render('ccform.ejs');
});

app.get("/users/home/jc",(req,res)=>{
        res.render("jcform.ejs");
});


app.post("/users/home/jc/jcform",(req,res)=>{
  let classid=req.body.cid;
  let userid=req.user.userid;
  let srollno=req.body.rollno;
  let a1=req.user.email;
  let sname=req.user.name;
  const temp= pool.query(`select classid,classname from classtable WHERE classid = $1`,[classid],(err,results)=>{
    if(err){console.log("join class error:",err.message);
      req.flash("errmsg","No such class exist");
      res.redirect('/users/home');
    }
    if(results.rows.length==0){
      req.flash("errmsg","No such class exist");
      res.redirect('/users/home/jc');
    }
    else{
      let p=`update classtable set classinfo=jsonb_insert(classinfo,'{ studentinfo,9999 }','{"id":"${userid}","rollno":"${srollno}","email":"${a1}","name":"${sname}","attendance":[],"assingment":[]}') where classid='${classid}'`;
        const v=pool.query(p,(err,r)=>{
          if(err){console.log("insert command fails during join class");}
        if(r){
          console.log("insert command successfull");
        }
        });
        let z=`update users set userinfo=jsonb_insert(userinfo,'{jclassid,99999}','{"id":"${classid}","name":"${results.rows[0].classname}","attendace":"","assingment":[]}') where email='${a1}'`;
        const t=pool.query(z,(err,result)=>{
          if(err){
            console.log("join class error:",err.message);
            res.render('index.ejs');
          }
          if(result){
            console.log("value entered successfully in users table during join class");
            res.redirect('/users/home');
          }
        });
        }
  }); 
});

app.get("/users/home/jc/jrpage/:classid",(req,res)=> {
    let classid = req.params.classid;
    let usid = req.user.userid;
    let str = `select * from classtable where classid='${classid}'`;
    const temp = pool.query(str, async (err, result) => {
      if (err) {
        console.log("Error in select command while jcclasss!!:", err.message);
      }
      if (result) {
        res.render('jrpage.ejs', { classtable: result.rows[0].classinfo.studentinfo, classing: result.rows[0].classinfo.assingment, usid: usid, classid: classid });
      }
    });

  });

app.get("/users/home/cc/crpage/:classid",(req,res)=>{
  let classid=req.params.classid;
  let str2=`select classinfo from classtable where classid='${classid}'`;
  const temp= pool.query(str2,(err,result)=>{
    if(err){
      console.log("Error in select command while crclasss!!:",err.message);
    }
    if(result){
      console.log(result.rows[0].classinfo.studentinfo);
      res.render('crpage.ejs',{classtable:result.rows[0].classinfo.studentinfo,classing:result.rows[0].classinfo.assingment,classid:classid});
    }
  });
  });



app.post("/users/home/cc/crpage/assignment/:classid",(req,res)=>{
  let assignment=req.body.description;
  let classid=req.params.classid;
  let p=`update classtable set classinfo=jsonb_insert(classinfo,'{assingment,9999}','"${assignment}"') where classid='${classid}'`;
  const temp=pool.query(p,(err,results)=>{
    if(err){console.log("error during assingment sub:",err.message);}
    if(results){
                console.log("successfully entered assignment");
                let arr=[];
                const temp=`select classinfo->'studentinfo' as res from classtable where classid='${classid}'`;
                pool.query(temp,async(err,result)=>{
                if(err){console.log(err.message);}
                if(result){
                            for(i=0;i<result.rows[0].res.length;i++){
                              console.log("email is ",result.rows[0].res[i].email);
                              arr.push(result.rows[0].res[i].email); }
        var ses = new AWS.SES();
        
        var params = {
          Source: req.user.email,
          Destination: { ToAddresses:arr },
          ReplyToAddresses: [ req.user.email],
          Message: {
              Body: {
                  Html: {
                      Charset: "UTF-8",
                      Data: `Your assignment: ${assignment}`
                  }
              },
              Subject: {
                  Charset: 'UTF-8',
                  Data: 'Assignment'
              }
          }
      };

        ses.sendEmail(params).promise().then(function(data){console.log(data)}).catch(function(err) {
          console.log("error while sending mail:",err.message);
        });  

      }
    });
    }
  });
  res.redirect(`/users/home/cc/crpage/${classid}`);  
});

app.post("/users/home/crpage/attendance/:classid",(req,res)=>{
  let classid=req.params.classid;
  let data=req.body.data;
  let array=[];
  if(req.body.arr ==='present' ||req.body.arr==='absent'){
    array.push(req.body.arr);
  }
  else{
    for(let i=0;i<req.body.arr.length;i++){
      array.push(req.body.arr[i]);
    }
  }
  console.log("arrayy is :",array);

  const temp=pool.query(`select classinfo->'studentinfo' as stuinfo from classtable WHERE classid = $1`,[classid],async(err,results)=>{
    if(err){console.log("join class error:",err.message);
      res.render('index.ejs');
    }
    if(results){
      let p=0;
      console.log("id iis:",results.rows[0].stuinfo[0].id);
      for( val of array) {
        console.log("val is:",val);
        let a=results.rows[0].stuinfo[p].id;
        let k=`update classtable m set classinfo = jsonb_set(
           m.classinfo::jsonb, 
           array['studentinfo',(pos1-1)::text,'attendance',999::text],
           '{"date":"${data}","att":"${val}"}'::jsonb 
        )::json
        from classtable l
        cross join jsonb_array_elements(l.classinfo->'studentinfo') with ordinality arr1(elems, pos1)
        where (elems->>'id')::text = '${a}' and m.classid='${classid}'`;
        const v=await pool.query(k,(err,r)=>{
          if(err){console.log("insert command fails during join class");}
          if(r){   console.log("insert command successfull"); }
           });  
           p++;
        }
      }  
  res.redirect(`/users/home/cc/crpage/${classid}`);
});

});

app.post("/users/home/cc/classf",(req,res)=>{
  let rs=cryptoRandomString({length: 10, characters: 'abclonh'});
  let a1=req.user.email;
  let cname=req.body.name;
  let z=`update users set userinfo=jsonb_insert(userinfo,'{cclassid,9999}','{"id":"${rs}","name":"${cname}"}') where email='${a1}'`;
  const temp2= pool.query(z,(err,result)=>{
    if(err){
      console.log("create class error:",err.message);
    }
    if(result){console.log("successfully inserted!!!");}
  });
  let k=`insert into classtable(classid,classname,classowner,classinfo) values($1,$2,$3,'{"studentinfo":[],"assingment":[]}')`;
  const temp= pool.query(k,[rs,cname,a1],(err,result)=>{
  if(err){
    console.log(err.message);
  }
  if(result){
    console.log("inserted into classtable");
  }
});
res.redirect('/users/home');
});

app.get("/videoconf/:classid",(req,res)=>{
  let name=req.user.name;
  let email=req.user.email;
  let classid=req.params.classid;
  res.render('videoconf.ejs',{name:name,email:email,classid:classid});
});

app.get("/videoconfcc/:classid",(req,res)=>{
  let name=req.user.name;
  let email=req.user.email;
  let classid=req.params.classid;
  let str2=`select classinfo from classtable where classid='${classid}'`;
  const temp= pool.query(str2,(err,result)=>{
    if(err){
      console.log("Error in select command while crclasss!!:",err.message);
    }
    if(result){
      console.log(result.rows[0].classinfo.studentinfo);
      res.render('videoconfcc.ejs',{classtable:result.rows[0].classinfo.studentinfo,classid:classid,name:name,email:email});
    }
  });
});
