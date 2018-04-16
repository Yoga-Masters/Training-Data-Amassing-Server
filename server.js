// ============================ PACKAGES SETUP =================================
const fs = require('fs');
const jimp = require("jimp");
const http = require('http');
const path = require('path');
const cors = require('cors');
const fsx = require('fs-extra');
const rimraf = require('rimraf');
const crypto = require("crypto");
const ytdl = require('ytdl-core');
const request = require('request');
const express = require('express');
const admin = require("firebase-admin");
const lineReader = require('line-reader');
const bodyParser = require("body-parser");
const stringify = require('csv-stringify');
const exec = require('child_process').execFile;
const removeDirectories = require('remove-empty-directories');
// ============================= GLOBALS SETUP =================================
var size = 100;
var maxFPS = 1;
var users = [];
var background;
var delAftr = false;
var started = false;
const app = express();
const server = http.createServer(app);
jimp.read("background.jpg", (err, image) => { background = image; });
ensureDirectoryExistence("./processing/pictures/frame.png");
ensureDirectoryExistence("./processing/pictures/processed/frame.png");
// =============================== APP SETUP ===================================
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.resolve(__dirname, 'client')));
server.listen(process.env.PORT || 80, process.env.IP || "0.0.0.0", () => console.log("Youtube Downloader listening at", server.address().address + ":" + server.address().port));
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
// ========================= PASSIVE FIREBASE FUNCTIONS ========================
adb.ref("size").on("value", snap => {
    size = snap.val();
    console.log("Size got updated to: " + size + "px!");
});
adb.ref("maxFPS").on("value", snap => {
    maxFPS = snap.val();
    console.log("maxFPS got updated to: " + maxFPS + "px!");
});
tdb.ref("delete").on("value", snap => {
    delAftr = snap.val();
    console.log("delAftr got updated to: " + delAftr);
});
tdb.ref("frames").on("value", snap => {
    ensureDirectoryExistence("./client/test.data");
    ensureDirectoryExistence("./training/angles/test.data");
    ensureDirectoryExistence("./training/images/test.data");
    ensureDirectoryExistence("./training/both/test.data");
    var data = snap.val();
    var time = Date.now();
    var trainingData = [];
    var poseIndex = { "warriorii": 0, "tree": 1, "triangle": 2 };
    for (const key of Object.keys(data)) {
        if (!(data[key].angles == 0 || data[key].angles == 1)) {
            data[key].angles.push(poseIndex[data[key].pose]);
            trainingData.push(data[key].angles);
        }
    }
    stringify(trainingData, (err, output) => {
        output = trainingData.length + "," + (trainingData[0].length - 1) + ",warriorii,tree,triangle\n" + output;
        fs.writeFile("./client/training_angles.csv", output, 'utf8', err => {
            tdb.ref("lastUpdated").set(Date.now());
            console.log("Wrote Angles only Training Data from scratch in " + (Date.now() - time) + "ms @ " + server.address().address + ":" + server.address().port + "/training_angles.csv");
            fsx.copy("./client/training_angles.csv", "./training/angles/training_angles.csv");
            fsx.copy("./client/training_angles.csv", "./training/both/training_angles.csv");
        });
    });
});
adb.ref("users").on("child_added", (snap, prevChildKey) => {
    var obj = {};
    obj[snap.val().key] = snap.val().updating;
    users.push(obj);
    adb.ref("users/" + snap.val().key + "/updating").on("value", snap => {
        users[snap.ref.parent.key] = snap.val();
    });
    adb.ref("users/" + snap.val().key + "/latestFrame").on("value", snap => {
        var time = Date.now();
        var data = snap.val();
        if(data == "") return;
        var key = snap.ref.parent.key;
        var ext = snap.val().split(';')[0].match(/jpeg|png|gif|jpg|webp/)[0];
        fs.writeFile("./processing/pictures/" + key + "." + ext, data.replace(/^data:image\/\w+;base64,/, ""), 'base64', err => {
            console.log("Saved new latestFrame from user " + key + " frame in " + (Date.now() - time) + "ms to ./processing/pictures/" + key + "." + ext + "...");
            if (!started) {
                console.log("STARTING APP OPENPOSE RUNNER...");
                started = true;
                // runOpenPose("./processing/pictures", "./processing/pictures/processed", () => {
                //     handleAppDataUpdating(ext);
                // });
            }
        });
    });
});
// =============================== ROUTING SETUP ===============================
app.get('/api', (req, res) => res.send({
    "return": 'Hello World @ Yoga Master - App & Training - Server DB API!'
}));
app.post('/postapi', (req, res) => {
    handleTrainingDataPost(req.body);
    fs.appendFile('history.txt', "\n" + JSON.stringify(req.body), err => {
        console.log("Got a POST: " + JSON.stringify(req.body) + "\nSaved to history.txt!");
        fsx.copy("history.txt", "./client/history.txt");
        res.redirect('/');
    });
});
app.get('/api/getpost', (req, res) => {
    console.log("Got a GET POST: " + req.query);
    handleTrainingDataPost(req.query);
    res.send({ "processing": req.query });
});
app.get('/api/deleteKey/:key', (req, res) => {
    tdb.ref("frames/" + req.params.key).set(null, () => {
        res.send({ "return": "Deleted key " + req.params.key + " data!" });
    });
});
app.get('/api/delete', (req, res) => {
    rimraf('./processing', () => {
        console.log("Cleared the processing folder...");
        res.send({ "return": "Deleted all cached training data!" });
    });
});
app.get('/api/redownload', (req, res) => {
    var count = 0;
    lineReader.eachLine('history.txt', (line, last) => {
        console.log("Started redownload of the processing folder using history.txt...");
        request.post("localhost:" + server.address().port + "/postapi").form(JSON.parse(line)); //FIX FOR ALEX'S HOME SERVER
        count++;
        if (last) res.send({ "return": "ReDownloaded " + count + " requests!" });
    });
});
// ======================== YOUTUBE DOWNLOADER FUNCTIONS =======================
//TODO: RUN OPENPOSE ON NEW FRAME
//  X   AFTER FINISHING OPENPOSE, READ IN OPENPOSE JSON DATA
//  X   PROCESS DATA AND UPLOAD ANGLES TO FIREBASE
//  X   PROCESS LATEST IMAGE AND UPLOAD TO FIREBASE
//  X   PROCESS OPENPOSE OUTPUT IMAGE AND UPLOAD TO FIREBASE
//  X   UPDATE LAST UPDATED TIME
function handleAppDataUpdating(ext) {
    runOpenPose("./processing/pictures", "./processing/pictures/processed", () => { handleAppDataUpdating(ext); });
    var time = Date.now();
    for (const user of Object.keys(users)) {
        if (!users[user]) return;
        else fs.readFile("./processing/pictures/processed/" + user + "_keypoints.json", 'utf8', (err, data) => {
            console.log("Finished reading file " + user + " json after " + (Date.now() - time) + "ms. Processing image...");
            var openPoseData = extractAngles(JSON.parse(data));
            if (openPoseData[0] == 0 || openPoseData[0] == 1) return; //TODO: TURN THIS ON FOR FINAL VERSION
            else imageProcessing("./processing/pictures/" + user + "." + ext, openPoseData[1][0], openPoseData[1][1], openPoseData[1][2], openPoseData[1][3], (err, trainingImage) => {
                openPoseFrameProcessing(("./processing/pictures/processed" + user + ".jpg"), (err, openposeImage) => { //TODO: FIX THIS PATH
                    console.log("Finished processing file " + user + " images after " + (Date.now() - time) + "ms. Uploading data...");
                    adb.ref("users/" + user).update({
                        "lastUpdated": Date.now(),
                        "latestOpenPoseFrame": openposeImage,
                        "latestTensorData/angles": openPoseData[0],
                        "latestTensorData/latestProcessedFrame": trainingImage
                    });
                });
            });
        });
    }
}

function handleTrainingDataPost(body) { // Download a video, convert it to frames, then upload the processed frames to firebase to train.
    var framesFolder = getRandomKey();
    var videoID = ytdl.getVideoID(body.url);
    var validVideo = ytdl.validateURL("youtube.com/watch?v=" + videoID);
    if (!validVideo)
        console.log("No video found OR not a valid video with ID \"" + videoID + "\" from \"" + body.url + "\"");
    else downloadYoutubeVideo(videoID, framesFolder, fps => {
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
        convertToFrames(framesDict, videoID, framesFolder, fps);
    });
}

function convertToFrames(framesDict, id, folder, fps) { // ffmpeg -i video.mp4 -vf select='eq(n\,30)+eq(n\,31)' -vsync 0 frames+"selectedPose"+%d.jpg
    ensureDirectoryExistence("./processing/videos/" + id + "/" + folder + "/1.jpg");
    var completion = {};
    var time = Date.now();
    for (const pose of Object.keys(framesDict)) completion[pose] = false;
    console.log("fps: " + fps);
    console.log("maxFPS: " + maxFPS);
    console.log("videoID: " + id);
    console.log("framesFolder: " + folder);
    console.log("framesDict: " + JSON.stringify(framesDict));
    for (const pose of Object.keys(framesDict)) {
        var framesList = "";
        framesDict[pose].forEach(frame => { for (var i = frame[0]; i <= frame[1]; i += (fps / maxFPS)) framesList += "eq(n\\," + i + ")+"; });
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
            checkFramesComplete(completion, id, folder, time);
        });
    }
}

function checkFramesComplete(check, video, folder, time) {
    for (const pose of Object.keys(check))
        if (!check[pose]) return;
    console.log("All frames for video " + video + " at folder " + folder + " have been extracted after " + (Date.now() - time) + "ms! Running Openpose on them...");
    processFrames(video, folder, false);
    // runOpenPose("./processing/videos/" + video + "/" + folder + "/", "", () => { processFrames(video, folder, true) }); //TODO: FIX FOR ALEX'S COMPUTER
}

function processFrames(video, folder, openPosed) {
    var time = Date.now();
    var fileExt = ".json";
    var fileEnd = "_keypoints.json";
    if (!openPosed) {
        fileExt = ".jpg";
        fileEnd = ".jpg";
    }
    fs.readdir("./processing/videos/" + video + "/" + folder + "/", (err, files) => {
        // var completion = {};
        // files.forEach(file => {
        //     if (path.extname(file) != fileExt) return;
        //     completion[file.slice(0, -(fileEnd.length))] = false;
        // });
        files.forEach(file => {
            if (path.extname(file) != fileExt) return;
            file = file.slice(0, -(fileEnd.length));
            console.log("Processing file " + file + " after " + (Date.now() - time) + "ms...");
            if (!openPosed) uploadFrameData(video, folder, file, extractAngles({}), time);
            else fs.readFile("./processing/videos/" + video + "/" + folder + "/" + file + "_keypoints.json", 'utf8', (err, data) => {
                uploadFrameData(video, folder, file, extractAngles(JSON.parse(data)), time);
            });
        });
    });
}

function uploadFrameData(video, folder, file, openPoseData, time) {
    console.log("Finished reading file " + file + " json after " + (Date.now() - time) + "ms. Processing image...");
    // if(openPoseData[0] == 0 || openPoseData[0] == 1) return; //TODO: TURN THIS ON FOR FINAL VERSION
    imageProcessing("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg", openPoseData[1][0], openPoseData[1][1], openPoseData[1][2], openPoseData[1][3], (err, trainingImage) => {
        openPoseFrameProcessing(("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg"), (err, openposeImage) => { //TODO: FIX THIS PATH
            console.log("Finished processing file " + file + " images after " + (Date.now() - time) + "ms. Uploading data...");
            tdb.ref("frames/" + video + "-" + folder + "-" + file).set({
                "timestamp": Date.now(),
                "key": video + "-" + folder + "-" + file,
                "angles": openPoseData[0],
                "pose": readPose(file),
                "trainingFrame": trainingImage, // <- BASE 64 OF 100x100 grayscaled and cropped training images
                "openposeFrame": openposeImage, // <- BASE 64 OF 100x100 cropped openpose output images
            }, err => {
                console.log("Finished uploading file " + file + " data after " + (Date.now() - time) + "ms..." + (delAftr ? " Deleting it now..." : ""));
                if (delAftr) delFrame(video, folder, file);
                removeDirectories('./processing');
            });
        });
    });
}

function downloadYoutubeVideo(url, folder, callback) { // Check if a video is downloaded and then download it, or skip ahead
    var dirStart = "./processing/videos/" + url + "/video_writing.mp4";
    var dirDone = "./processing/videos/" + url + "/video.mp4";
    ensureDirectoryExistence(dirDone);
    if (!fs.existsSync(dirDone)) {
        console.log("Found and downloading video " + url + " frames to folder " + folder + " at " + size + "px");
        var time = Date.now();
        var videoDownload = fs.createWriteStream(dirStart);
        ytdl("youtube.com/watch?v=" + url, {
            quality: 'highestvideo',
            filter: format => format.container === 'mp4' && format.audioEncoding === null
        }).pipe(videoDownload);
        videoDownload.on('open', data => {
            console.log("Started downloading video " + url + " after " + (Date.now() - time) + "ms");
        });
        videoDownload.on('error', data => {
            console.log("Video " + url + " FAILED TO DOWNLOAD after " + (Date.now() - time) + "ms");
        });
        videoDownload.on('finish', () => {
            fs.rename(dirStart, dirDone, err => {
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
// ==================== OPENPOSE + IMG PROCESSING FUNCTIONS ====================
function runOpenPose(dir, outDir, callback) { // OpenPoseDemo.exe --image_dir [DIRECTORY] --write_images [DIRECTORY] --write_keypoint_json [DIRECTORY] --no_display
    var time = Date.now();
    if (outDir == "") outDir = dir;
    console.log("Running openPoseDemo on \"" + dir + "\" outputting to \"" + outDir + "\"...");
    exec("openPoseDemo", ["--image_dir", dir,
        "--write_images", outDir,
        "--write_keypoint_json", outDir,
        "--no_display"
    ], (error, stdout, stderr) => {
        // console.log(error); console.log(stdout); console.log(stderr);
        console.log("Finished running openPoseDemo in " + (Date.now() - time) + "ms @ " + dir + " to " + outDir + "; processing files now...");
        callback();
    });
}
// TODO: FINISH THIS METHOD
function extractAngles(poseData) {
    var hasPerson = poseData.hasOwnProperty('people') && poseData.people.length > 0;
    //TODO Change to for loop method
    var fullPerson = hasPerson && poseData.people[0].pose_keypoints.length > 54;
    var keypoints = fullPerson ? poseData.people[0].pose_keypoints : null; // TODO: Read JSON file, Extract pose data from an array of 54 numbers
    var angles = fullPerson ? [getAngleAbsolute(keypoints[3], keypoints[4], keypoints[0], keypoints[1]),
        getAngleAbsolute(keypoints[3], keypoints[4], keypoints[15], keypoints[16]),
        getAngleAbsolute(keypoints[3], keypoints[4], keypoints[6], keypoints[7]),
        getAngleAbsolute(keypoints[15], keypoints[16], keypoints[18], keypoints[19]),
        getAngleAbsolute(keypoints[6], keypoints[7], keypoints[9], keypoints[10]),
        getAngleAbsolute(keypoints[18], keypoints[19], keypoints[21], keypoints[22]),
        getAngleAbsolute(keypoints[9], keypoints[10], keypoints[12], keypoints[13]),
        getAngleAbsolute(keypoints[3], keypoints[4], keypoints[33], keypoints[34]),
        getAngleAbsolute(keypoints[3], keypoints[4], keypoints[24], keypoints[25]),
        getAngleAbsolute(keypoints[33], keypoints[34], keypoints[36], keypoints[37]),
        getAngleAbsolute(keypoints[24], keypoints[25], keypoints[27], keypoints[28]),
        getAngleAbsolute(keypoints[36], keypoints[37], keypoints[39], keypoints[40]),
        getAngleAbsolute(keypoints[27], keypoints[28], keypoints[30], keypoints[31]),
        //TODO: PUT IN RELATIVE ANGLES
    ] : (!hasPerson ? 0 : 1);
    return [angles, [450, 50, 1450, 1050]]; // TODO: FIX THIS TO CORRECT NUMBERS
}

function imageProcessing(path, x1, y1, x2, y2, cb) {
    jimp.read(path, (err, image) => {
        background.resize((x2 - x1), (y2 - y1)) // Resizes the 1x1 Gray to the size we need it
            .composite(image, -x1, -y1) //Composite the image to have no Grey
            .resize(size, size) //resize to 100 x 100
            .quality(100) // set JPEG quality
            .greyscale() // greyscale
            .getBase64(jimp.MIME_JPEG, cb); // return image as base64 in passed in callback
    });
}

function openPoseFrameProcessing(path, cb) {
    jimp.read(path, (err, image) => {
        image.resize(size, size)
            .quality(100)
            .getBase64(jimp.MIME_JPEG, cb);
    });
}
// TODO: FINISH THIS METHOD
function getAngleAbsolute(x1, y1, x2, y2) { // Convert lines to vectors
    var vectorX = x2 - y1;
    var vectorY = y2 - y1;
    var magnitude = Math.pow((Math.pow(vectorX, 2) + Math.pow(vectorY, 2)), 0.5);
    var angle = radiansToDegrees(Math.acos(vectorY / magnitude));
    if (x2 >= x1)
        return angle;
    return 360 - angle;
}
// TODO: FINISH THIS METHOD
function getAngleRelative() { /* Convert 2 lines to 2 vectors to get the angle between vectors */ }
// ============================= HELPER FUNCTIONS ==============================
function ensureDirectoryExistence(filePath) {
    var dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) return true;
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

function delFrame(video, folder, file) { //TODO: FIX FOR ALL THREE FILES
    delFile("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg", () => {});
    // delFile("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg", () => {});
    // delFile("./processing/videos/" + video + "/" + folder + "/" + file + "_keypoints.json", () => {});
}

function delFile(path, cb) {
    fs.unlink(path, cb);
}

function getRandomKey(len) {
    return crypto.randomBytes(Math.floor(len / 2) || 8).toString('hex');
}

function readPose(name) {
    if (name.toLowerCase().includes("warriorii")) return "warriorii";
    else if (name.toLowerCase().includes("tree")) return "tree";
    else if (name.toLowerCase().includes("triangle")) return "triangle";
    else return false;
}

function radiansToDegrees(radians) {
    return (radians * 180 / Math.PI);
}

function degreesToRadians(degrees) {
    return (degrees * Math.PI / 180);
}
// ================ OLD CODE USED FOR TESTING AND UNDERSTANDING ================
// var bgSize = 1280;
// tdb.ref("backgroundSize").on("value", snap => {
//     var time = Date.now();
//     bgSize = snap.val();
//     background = image.resize(bgSize, bgSize);
//     console.log("bgSize got updated to: " + bgSize + "px in " + (Date.now() - time) + "ms; Updating background...");
// });
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
// ~~~~ FIREBASE READ OF BASE64 IMAGE -> SAVED TO FILE FOR PROCESSING : SUCCEED ~~~~
// tdb.ref("latestFrame").on("value", snap => { // MAY MOVE TO FB CLOUD FUNCTIONS
//     var ext = snap.val().split(';')[0].match(/jpeg|png|gif|jpg|webp/)[0];
//     var time = Date.now();
//     ensureDirectoryExistence("./processing/pictures/frame.png");
//     fs.writeFile("./processing/pictures/latestFrame." + ext, snap.val().replace(/^data:image\/\w+;base64,/, ""), 'base64', err => {
//         console.log("Saved new frame in " + (Date.now() - time) + "ms to processing/pictures/latestFrame." + ext + "...");
//     });
// });
// ---------
// runOpenPose("./processing/videos/" + video + "/" + folder + "/", () => {
//     fs.readdir("./processing/videos/" + video + "/" + folder + "/", (err, files) => {
//         files.forEach(file => {
//             if (path.extname(file) != '.json') return;
//             file = file.slice(0, -("_keypoints.json".length));
//             var openPoseData = extractAngles("./processing/videos/" + video + "/" + folder + "/" + file + "_keypoints.json");
//             imageProcessing("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg",
//                 openPoseData[1][0], openPoseData[1][1], openPoseData[1][2], openPoseData[1][3], (image) => {
//                     // image.write("newtest.jpg");
//                     tdb.ref("frames/" + video + "-" + folder + "-" + file).set({
//                         "timestamp": Date.now(),
//                         "key": video + "-" + folder + "-" + file,
//                         "angles": openPoseData[0],
//                         "pose": pose,
//                         "trainingFrame": image, // <- BASE 64 OF 100x100 grayscaled and cropped training images
//                         // "openPoseFrame": base64Img.base64Sync("FinalOpenPoseImage"), // <- BASE 64 OF 100x100 cropped openpose output images
//                     });
//                 });
//         });
//     });
// });
