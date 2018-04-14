// ============================= GLOBALS SETUP =================================
var size = 100;
var maxFPS = 1;
var bgSize = 1280;
const fs = require('fs');
const jimp = require("jimp");
const http = require('http');
const path = require('path');
const cors = require('cors');
const crypto = require("crypto");
const ytdl = require('ytdl-core');
const express = require('express');
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const stringify = require('csv-stringify');
const exec = require('child_process').execFile;
// =============================== APP SETUP ===================================
var background;
const app = express();
const server = http.createServer(app);
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.resolve(__dirname, 'client')));
server.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", () => console.log("Youtube Downloader listening at", server.address().address + ":" + server.address().port));
// ============================ FIREBASE SETUP =================================
admin.initializeApp({ // Connecting to Firebase Training Database
    credential: admin.credential.cert(require("./json/yoga-master-training-db-d9acdc86dca0.json")),
    databaseURL: "https://yoga-master-training-db.firebaseio.com"
}); // , storageBucket: "yoga-master-training-db.appspot.com/"
var appAdmin = admin.initializeApp({ // Connecting to Firebase App Database
    credential: admin.credential.cert(require("./json/yoga-master-app-774bc242a8b4.json")),
    databaseURL: "https://yoga-master-app.firebaseio.com"
}, "app"); // , storageBucket: "yoga-master-app.appspot.com"
console.log("Connected to training data firebase as \"" + admin.app().name + "\"");
console.log("Connected to yogamaster app firebase as \"" + appAdmin.name + "\"");
var tdb = admin.database();
var adb = appAdmin.database();
// ~~~~ CLOUD STORAGE EXPERIMENTATION : FAILURE ~~~~
// var tbucket = admin.storage().bucket();
// var abucket = appAdmin.storage().bucket();
// tbucket.upload("img.jpg")
//     .then((data) => {
//         console.log(data);
//         console.log(data[0]);
//         console.log(data[1]);
//     })
//     .catch(err => {
//         console.error('ERROR:', err);
//     });
// ~~~~ FILE READ -> OPENPOSE -> FIREBASE EXPERIMENT : SUCCEED ~~~~
// fs.readdir("./processing/videos/UIrLyE7iz50/546adeb47c6f172c/", (err, files) => {
//     files.forEach(file => {
//         if (path.extname(file) == '.jpg')
//             file = file.slice(0, -4);
//         console.log(file);
//     });
// });
// ========================= PASSIVE FIREBASE FUNCTIONS ========================
tdb.ref("backgroundSize").on("value", snap => {
    var time = Date.now();
    bgSize = snap.val();
    jimp.read("background.jpg", (err, image) => {
        background = image.crop(0, 0, bgSize, bgSize);
        console.log("bgSize got updated to: " + bgSize + "px in " + (Date.now() - time) + "ms; Updating background...");
    });
});

tdb.ref("frames").on("value", snap => {
    ensureDirectoryExistence("./client/training_angles.csv");
    var data = snap.val();
    var time = Date.now();
    var trainingData = [];
    var poseIndex = { "warriorii": 0, "tree": 1, "triangle": 2 };
    for (const key of Object.keys(data)) {
        // if (!snap.val()[key].hasOwnProperty("download") || snap.val()[key].download) {
        //JSON.stringify(snap.val()[key])
        // console.log("Wrote new " + +" pose frame " + (Date.now() - time) + "ms ago! Check it out @: " + snap.val()[key].originalFrameLink);
        // }
        data[key].angles.push(poseIndex[data[key].pose]);
        trainingData.push(data[key].angles);
    }
    stringify(trainingData, function(err, output) {
        output = trainingData.length + "," + (trainingData[0].length - 1) + ",warriorii,tree,triangle\n" + output;
        fs.writeFile("./client/training_angles.csv", output, 'utf8', (err) => {
            tdb.ref("lastUpdated").set(Date.now());
            console.log("Wrote new Training Data from scratch in " + (Date.now() - time) + "ms! Check it out @: " + server.address().address + ":" + server.address().port + "/training_angles.csv");
        });
    });
});

// tdb.ref("latestFrame").on("value", snap => { // MAY MOVE TO FB CLOUD FUNCTIONS
//     var ext = snap.val().split(';')[0].match(/jpeg|png|gif|jpg|webp/)[0];
//     var time = Date.now();
//     ensureDirectoryExistence("./processing/pictures/frame.png");
//     fs.writeFile("./processing/pictures/latestFrame." + ext, snap.val().replace(/^data:image\/\w+;base64,/, ""), 'base64', err => {
//         console.log("Saved new frame in " + (Date.now() - time) + "ms to processing/pictures/latestFrame." + ext + "...");
//     });
// });

adb.ref("size").on("value", snap => {
    size = snap.val();
    console.log("Size got updated to: " + size + "px!");
});

adb.ref("maxFPS").on("value", snap => {
    maxFPS = snap.val();
    console.log("maxFPS got updated to: " + maxFPS + "px!");
});
// =============================== ROUTING SETUP ===============================
app.get('/api', (req, res) => res.send({
    "return": 'Hello World @ Yoga Master App & Training Server DB API!'
}));

app.get('/api/getpost', (req, res) => {
    console.log("Got a GET POST: " + req.query);
    res.send({
        "rtrn": handleTrainingDataPost(JSON.stringify(req.query))
    });
});

app.post('/postapi', (req, res) => {
    console.log("Got a POST: " + JSON.stringify(req.body));
    handleTrainingDataPost(req.body);
    res.redirect('/');
});
// ======================== YOUTUBE DOWNLOADER FUNCTIONS =======================
function handleTrainingDataPost(body) { // Download a video, convert it to frames, then upload the processed frames to firebase to train.
    var framesFolder = getRandomKey();
    var videoID = ytdl.getVideoID(body.url);
    var validVideo = ytdl.validateURL("youtube.com/watch?v=" + videoID);
    if (!validVideo)
        console.log("No video found OR not a valid video with ID \"" + videoID + "\" from \"" + body.url + "\"");
    else downloadYoutubeVideo(videoID, framesFolder, (fps) => {
        var framesDict = {};
        var length = (Object.keys(body).length - 1) / 5;
        console.log("body: " + JSON.stringify(body));
        console.log("length: " + length);
        for (var i = 1; i <= length; i++) {
            var pose = body["selectedPose" + i];
            if (framesDict[pose] === undefined) framesDict[pose] = [];
            framesDict[pose].push([
                (parseInt(body["startTimeStampMin" + i]) * 60 + parseInt(body["startTimeStampSec" + i])) * fps,
                (parseInt(body["endTimeStampMin" + i]) * 60 + parseInt(body["endTimeStampSec" + i])) * fps
            ]);
        }
        convertToFrames(framesDict, videoID, framesFolder, fps, Date.now());
    });
}

function checkFramesComplete(check, pose, video, folder) {
    for (const pose of Object.keys(check))
        if (!check[pose]) return;
    console.log("After finishing pose " + pose + ", we are at: ");
    console.log(check);
    console.log("All frames for video " + video + " at folder " + folder + " have been extracted! Running Openpose on them...");
    runOpenPose("./processing/videos/" + video + "/" + folder + "/", () => {
        console.log("Finished running openPoseDemo! Reading all images in 1 by 1 now...");
        fs.readdir("./processing/videos/" + video + "/" + folder + "/", (err, files) => {
            files.forEach(file => {
                if (path.extname(file) != '.json') return;
                file = file.slice(0, -("_keypoints.json".length));
                var openPoseData = extractAngles("./processing/videos/" + video + "/" + folder + "/" + file + "_keypoints.json");
                imageProcessing("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg",
                    openPoseData[1][0], openPoseData[1][1], openPoseData[1][2], openPoseData[1][3], (image) => {
                        // image.write("newtest.jpg");
                        tdb.ref("frames/" + video + "-" + folder + "-" + file).set({
                            "timestamp": Date.now(),
                            "key": video + "-" + folder + "-" + file,
                            "angles": openPoseData[0],
                            "pose": pose,
                            "trainingFrame": image, // <- BASE 64 OF 100x100 grayscaled and cropped training images
                            // "openPoseFrame": base64Img.base64Sync("FinalOpenPoseImage"), // <- BASE 64 OF 100x100 cropped openpose output images
                        });
                    });
            });
        });
    });
}

function convertToFrames(framesDict, id, folder, fps, time) { // ffmpeg -i video.mp4 -vf select='eq(n\,30)+eq(n\,31)' -vsync 0 frames+"selectedPose"+%d.jpg
    var framesList = "";
    var completion = {};
    for (const pose of Object.keys(framesDict)) completion[pose] = false;
    console.log("fps: " + fps);
    console.log("maxFPS: " + maxFPS);
    console.log("videoID: " + id);
    console.log("framesFolder: " + folder);
    console.log("framesDict: " + JSON.stringify(framesDict));
    ensureDirectoryExistence("./processing/videos/" + id + "/" + folder + "/1.jpg");
    for (const pose of Object.keys(framesDict)) {
        framesDict[pose].forEach(frame => { for (var i = frame[0]; i <= frame[1]; i += (fps / maxFPS)) framesList = framesList + "eq(n\\," + i + ")+"; });
        framesList = framesList.slice(0, -1);
        console.log("Putting framesList frames for " + pose + " into " + id + "/" + folder);
        console.log("framesList: " + framesList);
        exec('ffmpeg', [
            '-i', "./processing/videos/" + id + "/video.mp4",
            '-vf', 'select=\'' + framesList + '\'',
            '-vsync', '0', "./processing/videos/" + id + "/" + folder + "/" + pose + "%d.jpg"
        ], (error, stdout, stderr) => {
            completion[pose] = true;
            console.log("Finished " + pose + " pose for " + id + " @ " + folder + " in " + (Date.now() - time) + "ms!");
            // checkFramesComplete(completion, pose, id, folder);
        });
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
        callback(Math.round(parseInt(stdout.substring(0, stdout.indexOf("/"))) / parseInt(stdout.substring(stdout.indexOf("/") + 1))));
    });
}

function downloadYoutubeVideo(url, folder, callback) { // Check if a video is downloaded and then download it, or skip ahead
    var dirName = "./processing/videos/" + url + "/video_writing.mp4";
    var dirDone = "./processing/videos/" + url + "/video.mp4";
    ensureDirectoryExistence(dirDone);
    if (!fs.existsSync(dirDone)) {
        console.log("Found and downloading video " + url + " frames to folder " + folder + " at " + size + "px");
        var time = Date.now();
        var videoDownload = fs.createWriteStream(dirName);
        ytdl("youtube.com/watch?v=" + url, {
            quality: 'highestvideo',
            filter: (format) => format.container === 'mp4' && format.audioEncoding === null
        }).pipe(videoDownload);
        videoDownload.on('open', (data) => {
            console.log("Started downloading video " + url + " after " + (Date.now() - time) + "ms");
        });
        videoDownload.on('error', (data) => {
            console.log("Video " + url + " FAILED TO DOWNLOAD after " + (Date.now() - time) + "ms");
        });
        videoDownload.on('finish', () => {
            fs.rename(dirName, dirDone, function(err) {
                console.log("Finished downloading video " + url + " after " + (Date.now() - time) + "ms");
                getFPS(dirDone, callback);
            });
        });
    }
    else {
        console.log("Video " + url + " was already downloaded!");
        getFPS(dirDone, callback);
    }
}

// ==================== OPENPOSE + IMG PROCESSING FUNCTIONS ====================
function imageProcessing(path, x1, y1, x2, y2, cb) {
    jimp.read(path, function(err, image) {
        var x = x1 > 0 && y1 > 0 ? image.bitmap.width - x1 : Math.abs(x1);
        var y = x1 > 0 && y1 > 0 ? image.bitmap.height - y1 : Math.abs(y1);
        background.crop(0, 0, (x2 - x1), (y2 - y1)) // Crops the Gray to all we need it for
            .composite(image, x, y) //Composite the image to have no Grey
            .resize(size, size) //resize to 100 x 100
            .quality(100) // set JPEG quality
            .greyscale() // greyscale
            .getBase64(jimp.MIME_JPEG, cb); // return image as base64 in passed in callback
    });
}

function extractAngles(poseDataPath) {
    var keypoints = JSON.parse(fs.readFileSync(poseDataPath, 'utf8')).people[0].pose_keypoints; // Read JSON file, Extract pose data from an array of 54 numbers
    return [
        [getAngle(keypoints[3], keypoints[4], keypoints[0], keypoints[1]),
            getAngle(keypoints[3], keypoints[4], keypoints[15], keypoints[16]),
            getAngle(keypoints[3], keypoints[4], keypoints[6], keypoints[7]),
            getAngle(keypoints[15], keypoints[16], keypoints[18], keypoints[19]),
            getAngle(keypoints[6], keypoints[7], keypoints[9], keypoints[10]),
            getAngle(keypoints[18], keypoints[19], keypoints[21], keypoints[22]),
            getAngle(keypoints[9], keypoints[10], keypoints[12], keypoints[13]),
            getAngle(keypoints[3], keypoints[4], keypoints[33], keypoints[34]),
            getAngle(keypoints[3], keypoints[4], keypoints[24], keypoints[25]),
            getAngle(keypoints[33], keypoints[34], keypoints[36], keypoints[37]),
            getAngle(keypoints[24], keypoints[25], keypoints[27], keypoints[28]),
            getAngle(keypoints[36], keypoints[37], keypoints[39], keypoints[40]),
            getAngle(keypoints[27], keypoints[28], keypoints[30], keypoints[31])
        ],
        [100, 100, 200, 200]
    ];
}

function runOpenPose(dir, callback) { // OpenPoseDemo.exe --image_dir [DIRECTORY] --write_images [DIRECTORY] --write_keypoint_json [DIRECTORY] --no_display
    console.log("Running openPoseDemo on \"" + dir + "\"...");
    exec("openPoseDemo", ["--image_dir", dir,
        // "--write_images", dir,
        "--write_keypoint_json", dir,
        "--no_display"
    ], (error, stdout, stderr) => {
        callback();
    });
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

function getAngle(x1, y1, x2, y2) { // Convert lines to vectors
    var vectorX = x2 - y1;
    var vectorY = y2 - y1;
    var magnitude = Math.pow((Math.pow(vectorX, 2) + Math.pow(vectorY, 2)), 0.5);
    var angle = radiansToDegrees(Math.acos(vectorY / magnitude));
    if (x2 >= x1)
        return angle;
    return 360 - angle;
}

function radiansToDegrees(radians) {
    return (radians * 180 / Math.PI);
}

function degreesToRadians(degrees) {
    return (degrees * Math.PI / 180);
}

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
//{ "warriorii": [[start1, end1], [start2, end2]],
//  "triangle": [[start1, end1], [start2, end2]],
//  "tree": [[start1, end1], [start2, end2]]}
// ffmpeg -i ./processing/videos/UIrLyE7iz50/video.mp4 -vf select='eq(n\,30)+eq(n\,31)' -vsync 0 ./processing/videos/UIrLyE7iz50/e59cc9618ebb9fb3/warriorii%d.jpg
// ---------
// Original Image -> Linked to cloud storage
// Openpose Img -> 100x100 px version of openpose output
// Training Img -> Original img cropped to person, grayscaled and scaled down to 100x100 px
// Angles 1-n -> Array of angles
// Pose -> The pose done in the image
// download -> Whether to download this data or not.
