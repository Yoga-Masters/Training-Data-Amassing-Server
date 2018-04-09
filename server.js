// ===================== GLOBALS SETUP ===========================
var size = 100;
var maxFPS = 30;
const fs = require('fs');
const http = require('http');
const path = require('path');
const cors = require('cors');
const crypto = require("crypto");
const ytdl = require('ytdl-core');
const express = require('express');
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const exec = require('child_process').execFile;
// ======================= APP SETUP =============================
const app = express();
const server = http.createServer(app);
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.resolve(__dirname, 'client')));
server.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", () => console.log("Youtube Downloader listening at", server.address().address + ":" + server.address().port));
// ===================== FIREBASE SETUP ==========================
admin.initializeApp({ // Connecting to Firebase Training Database
    credential: admin.credential.cert(require("./json/yoga-master-training-db-d9acdc86dca0.json")),
    databaseURL: "https://yoga-master-training-db.firebaseio.com"
});
var appAdmin = admin.initializeApp({ // Connecting to Firebase App Database
    credential: admin.credential.cert(require("./json/yoga-master-app-774bc242a8b4.json")),
    databaseURL: "https://yoga-master-app.firebaseio.com"
}, "app");
console.log("Connected to training data firebase as \"" + admin.app().name + "\"");
console.log("Connected to yogamaster app firebase as \"" + appAdmin.name + "\"");
var tauth = admin.auth();
var tdb = admin.database();
var aauth = appAdmin.auth();
var adb = appAdmin.database();
// === PASSIVE FIREBASE FUNCTIONS (MAY MOVE TO CLOUD FUNCTIONS) ==
// Original Image -> Linked to cloud storage
// Openpose Img -> 100x100 px version of openpose output
// Training Img -> Original img cropped to person, grayscaled and scaled down to 100x100 px
// Angles 1-n -> Array of angles
// Pose -> The pose done in the image
// download -> Whether to download this data or not.
tdb.ref("frames").on("value", snap => {
    for (const key of Object.keys(snap.val())) {
        if (!snap.val()[key].hasOwnProperty("download") || snap.val()[key].download) {
            var time = Date.now();
            ensureDirectoryExistence("./training/key.json");
            fs.writeFile("./training/" + key + ".json", JSON.stringify(snap.val()[key]), 'utf8');
            console.log("Wrote new " + snap.val()[key].pose + " pose frame " + (Date.now() - time) + "ms ago! Check it out @: " + snap.val()[key].originalFrameLink);
        }
    }
});

tdb.ref("latestFrame").on("value", snap => {
    var ext = snap.val().split(';')[0].match(/jpeg|png|gif|jpg|webp/)[0];
    var time = Date.now();
    ensureDirectoryExistence("./processing/pictures/frame.png");
    fs.writeFile("./processing/pictures/latestFrame." + ext, snap.val().replace(/^data:image\/\w+;base64,/, ""), 'base64', err => {
        console.log("Saved new frame in " + (Date.now() - time) + "ms to processing/pictures/latestFrame." + ext + "...");
    });
});

adb.ref("size").on("value", snap => {
    size = snap.val();
    console.log("Size got updated to: " + size + "px!");
});

adb.ref("maxFPS").on("value", snap => {
    maxFPS = snap.val();
    console.log("maxFPS got updated to: " + maxFPS + "px!");
});
// ===================== ROUTING SETUP ===========================
app.get('/api', (req, res) => res.send({ "return": 'Hello World @ Yoga Master App & Training Server DB API!' }));

// app.get('/api/openpose', (req, res) => { // Handles individual img openpose handling; useful for demo
//     var base64Data = req.query.img;
// });

app.get('/api/getpost', (req, res) => {
    console.log("Got a GET POST: " + req.query);
    res.send({ "rtrn": handleTrainingDataPost(JSON.stringify(req.query)) });
});

app.post('/postapi', (req, res) => {
    console.log("Got a POST: " + JSON.stringify(req.body));
    handleTrainingDataPost(req.body);
    res.redirect('/');
});

// ========================== CALL FUNCTIONS ==========================
function handleTrainingDataPost(body) {
    var framesFolder = getRandomKey();
    var videoID = ytdl.getVideoID(body.url);
    var validVideo = ytdl.validateURL("youtube.com/watch?v=" + videoID);
    if (!validVideo)
        console.log("No video found OR not a valid video with ID \"" + videoID + "\" from \"" + body.url + "\"");
    else downloadYoutubeVideo(videoID, framesFolder, (fps, videoPath) => {
        var framesDict = {};
        var length = (Object.keys(body).length - 1) / 5;
        console.log("body: " + JSON.stringify(body));
        console.log("length: " + length);
        for (var i = 1; i <= length; i++) {
            var pose = body["selectedPose" + i];
            if (framesDict[pose] === undefined) framesDict[pose] = [];
            framesDict[pose].push([
                (body["startTimeStampMin" + i] * 60 + body["startTimeStampSec" + i]) * fps,
                (body["endTimeStampMin" + i] * 60 + body["endTimeStampSec" + i]) * fps
            ]);
        }
        convertToFrames(framesDict, videoID, framesFolder, fps);
    });
}

function convertToFrames(framesDict, id, folder, fps) { // ffmpeg -i video.mp4 -vf select='eq(n\,30)+eq(n\,31)' -vsync 0 frames+"selectedPose"+%d.jpg
    var framesList = "";
    console.log("fps: " + fps);
    console.log("maxFPS: " + maxFPS);
    console.log("videoID: " + id);
    console.log("framesFolder: " + folder);
    console.log("framesDict: " + JSON.stringify(framesDict));
    ensureDirectoryExistence("./processing/videos/" + id + "/" + folder + "/1.jpg");
    for (const pose of Object.keys(framesDict)) {
        framesDict[pose].forEach(function(frame) {
            for (var i = frame[0]; i <= frame[1]; i += (fps / maxFPS))
                framesList = framesList + "eq(n\\," + i + ")+";
        });
        framesList = framesList.slice(0, -1);
        console.log("framesList: " + framesList);
        console.log("Putting framesList frames for " + pose + " into " + id + "/" + folder);
        exec('ffmpeg', [
            '-i', "./processing/videos/" + id + "/video.mp4",
            '-vf', 'select=\'' + framesList + '\'',
            '-vsync', '0', "./processing/videos/" + id + "/" + folder + "/" + pose + "%d.jpg"
        ]);
        framesList = "";
    }
}

function getFPS(path, callback) { // ffprobe -v 0 -of csv=p=0 -select_streams 0 -show_entries stream=r_frame_rate infile
    exec('ffprobe', ['-v', '0',
        '-of', 'csv=p=0',
        '-select_streams', '0',
        '-show_entries',
        'stream=r_frame_rate', path
    ], (error, stdout, stderr) => {
        console.log("FPS is " + stdout);
        callback(parseInt(stdout.substring(0, stdout.indexOf("/"))) / parseInt(stdout.substring(stdout.indexOf("/") + 1)));
    });
}

function downloadYoutubeVideo(url, folder, callback) {
    var dirname = "./processing/videos/" + url + "/video.mp4";
    ensureDirectoryExistence(dirname);
    if (!fs.existsSync(dirname)) {
        console.log("Found and downloading video " + url + " frames to folder " + folder + " at " + size + "px");
        var time = Date.now();
        var videoDownload = fs.createWriteStream(dirname);
        ytdl("youtube.com/watch?v=" + url, { filter: (format) => format.container === 'mp4' }).pipe(videoDownload);
        videoDownload.on('open', (data) => {
            console.log("Started downloading video after " + (Date.now() - time) + "ms");
        });
        videoDownload.on('close', () => {
            console.log("Finished downloading video after " + (Date.now() - time) + "ms");
            getFPS(dirname, callback);
        });
    }
    else {
        console.log("Video " + url + " is already downloaded!");
        getFPS(dirname, callback);
    }
}
// ========================== HELPER FUNCTIONS ==========================
function getRandomKey(len) {
    return crypto.randomBytes(Math.floor(len / 2) || 8).toString('hex');
}

function ensureDirectoryExistence(filePath) {
    var dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) return true;
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

// https://github.com/cacheflow/youtube-video-to-frames/blob/master/index.js
// ---------
// const downloadVideo = () => {
//     options = Object.assign(defaultVideoOptions, {})
//     videoWriteStream = fs.createWriteStream(`${options.videoName}.mp4`)
//     ytdl(options.videoUrl).pipe(videoWriteStream);
//     videoWriteStream.on('open', (data) => {
//         console.log("Downloading video before converting to frames.")
//     })
//     videoWriteStream.on('error', (err) => {
//         errAndExit(err)
//     })
//     videoWriteStream.on('close', () => {
//         let pluralOrSingular = options.fps > 1 ? 'frames' : 'frame'
//         console.log(`Finished downloading video. Now screenshotting ${options.fps} ${pluralOrSingular} per second.`)
//         convertVideoToFrames()
//     })
// }
// ---------
// const convertVideoToFrames = () => {
//     let options = getOptions()
//     let ffmpegVideoFrameProcess = spawn('ffmpeg', [
//         '-i', `./${options.videoName}.mp4`,
//         '-f', 'image2',
//         '-bt', '20M',
//         '-vf', `fps=${options.fps}`,
//         `./${options.imgFileName}%03d.jpg`
//     ])

//     ffmpegVideoFrameProcess.stdout.on('data', (data) => {
//         console.log(data.toString());
//     });

//     ffmpegVideoFrameProcess.stderr.on('data', (err) => {
//         console.log(err.toString());
//     });

//     ffmpegVideoFrameProcess.stdout.on('close', (data) => {
//         process.exit()
//     });
// }
// ---------
// //!!!!!!!!Video needs to be detected as done downloading, then you can do the math below:
// //body contains url, timestamps and selected pose
// console.log(body);
// var length = (Object.keys(body).length - 1) / 5;
// //turn timestamps into frames based off  video's fps as so: 'eq(n\,180)+eq(n\,210)'
// var framesDict = {};
// for (var i = 1; i < length; i++) {
//     var startMin = body["startTimeStampMin" + i];
//     var startSec = body["startTimeStampSec" + i];
//     var endMin = body["endTimeStampMin" + i];
//     var endSec = body["endTimeStampSec" + i];
//     var pose = body["selectedPose" + i];
//     var startTime = startMin * 60 + startSec;
//     var endTime = endMin * 60 + endSec;
//     var startFrame = startTime * fps;
//     var endFrame = endTime * fps;
//     if (framesDict[pose] === undefined) framesDict[pose] = [];
//     framesDict[pose].push([startFrame, endFrame]);
//     // framesDict[startFrame] = pose;
//     // framesDict[endFrame] = pose;
// }
// convertToFrames(framesDict);
// // convertToFrames(Object.keys(framesDict));
// ---------
// var s = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

//return Array(40).join().split(',').map(function() { return s.charAt(Math.floor(Math.random() * s.length)); }).join('');
// var arr = new Uint8Array((len || 15) / 2);
// window.crypto.getRandomValues(arr);
// return Array.from(arr, dec => dec.toString(36).substr(dec.toString(36).indexOf(".") + 1)).join('');
// ---------
// NOT using the format below:
// [[start1, end1, pose],
//  [start2, end2, pose],
//  [start3, end3, pose]]
// USING THE FORMAT BELOW:
//{ "warriorII": [[start1, end1], [start2, end2]],
//  "triangle": [[start1, end1], [start2, end2]],
//  "tree": [[start1, end1], [start2, end2]]}
// ffmpeg -i ./processing/videos/UIrLyE7iz50/video.mp4 -vf select='eq(n\,30)+eq(n\,31)' -vsync 0 ./processing/videos/UIrLyE7iz50/e59cc9618ebb9fb3/warriorii%d.jpg
