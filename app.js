var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
const { Server } = require("socket.io");
const http = require('http');
const dotenv = require('dotenv')
const { S3Client, GetObjectCommand, PutObjectCommand, S3 } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

dotenv.config()


var app = express();
const server = http.createServer(app);

const io = new Server(server);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const cors = require('cors');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));


const corsOption = {
  origin:true
}


app.use(cors(corsOption));
app.options('*', cors(corsOption));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

const s3Client = new S3Client({
  region:"ap-south-1",
  credentials:{
    accessKeyId:process.env.ACCESS_KEY_ID,
    secretAccessKey:process.env.SECRET_ACCESS_KEY
  }
})

const connectedUsers = {};
const chatRequests = {};
const publicUsers = {};

function getSocketIdfromNickname(nickname) {
  return Object.keys(connectedUsers).find(key => connectedUsers[key] === nickname);
}
function getSocketIdfromNicknamePUBLIC(nickname) {
  return Object.keys(publicUsers).find(key => publicUsers[key] === nickname);
}


io.on('connection', (socket) => {
  console.log("connected");


  //PublicChat
  socket.on('publicJoin',(nickname)=>{
    socket.join("publicRoom")
    publicUsers[socket.id] = nickname
    io.to("publicRoom").emit("totalUsers",Object.values(publicUsers).length)
  })

  socket.on("exitGroupChat",(nickname)=>{
    const socketId = getSocketIdfromNicknamePUBLIC(nickname)
    if(socketId){
      socket.leave("publicRoom")
      delete publicUsers[socketId]  
      io.to("publicRoom").emit("totalUsers",Object.values(publicUsers).length)
    }
  })

  socket.on("groupsendMessage",(data)=>{
    const socketId = getSocketIdfromNicknamePUBLIC(data.nickname)
    if(socketId){
      socket.to("publicRoom").emit("newMessagePublicChat",{nickname:data.nickname, message:data.message})
    }
  })

  //Upload File
  socket.on('fileMeta',async ({fileName, contentType})=>{
    console.log(fileName)
    async function putObjectUrl(filename, contentType){
      const command = new PutObjectCommand({
        Bucket: "nodejs-privatee",
        Key:`/uploads/${filename}`,
        ContentType: contentType
      })
      const url = await getSignedUrl(s3Client,command)
      console.log(url)
      return url

    }
    const presSignedUrl = await putObjectUrl(fileName, contentType)
    socket.emit('preSignedUrl',presSignedUrl)
  })

  socket.on('fileUploaded',async ({peer, nickname, key})=>{
    async function getObjectUrl(key){
      const command = new GetObjectCommand({
        Bucket: "nodejs-privatee",
        Key:key

      })
      const message = await getSignedUrl(s3Client,command)
      const socketId = getSocketIdfromNickname(peer);
      if (socketId) {
        io.to(socketId).emit('newMessage', { message, from: nickname });
        socket.emit('UploadedFileUrl',message)
    }    
  }
  await getObjectUrl(key)
  })

  //PersonalChat
  socket.on('join', (nickname) => {
    connectedUsers[socket.id] = nickname;
    io.emit('OnlineUsersList', connectedUsers);
  });

  socket.on('sendMessage', ({ message, peer, nickname }) => {
    const socketId = getSocketIdfromNickname(peer);
    if (socketId) {
      io.to(socketId).emit('newMessage', { message, from: nickname });
    }
  });

  socket.on('chatRequest', ({ peer, nickname }) => {
    const peerSocketId = getSocketIdfromNickname(peer);
    if (peerSocketId) {
      chatRequests[peerSocketId] = { from: nickname };
      io.to(peerSocketId).emit('chatRequestResponse', nickname);
    }
  });

  socket.on('acceptChatRequest', ({ from, nickname }) => {
    const socketId = getSocketIdfromNickname(from);
    if (socketId) {
      io.to(socketId).emit('acceptChatRequestResponse', nickname);
      delete chatRequests[socket.id];
    }
  });
  socket.on('exitChat', ({ peer, nickname }) => {
    console.log("Exit chat")
    const peerSocketId = getSocketIdfromNickname(peer);
    if (peerSocketId) {
        io.to(peerSocketId).emit('peerExited', { nickname });
    }
});
  socket.on('disconnect', () => {
    if(connectedUsers[socket.id]){
      delete connectedUsers[socket.id];
      io.emit('OnlineUsersList', connectedUsers);
      delete chatRequests[socket.id];
    }
    else if(publicUsers[socket.id]){
      delete publicUsers[socket.id]
      io.to("publicRoom").emit("totalUsers",Object.values(publicUsers).length)
    }

  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});


module.exports = app;
