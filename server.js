// cls && browser-sync start --proxy localhost:80 --files "**/*" && ngrok http --bind-tls "both" 80 | npm start
// clear && browser-sync start --proxy localhost:8080 --port 8081 --files "**/*" | npm start
// cls && browser-sync start --proxy localhost:80 --files "**/*" | npm start
// cls && npm start
// ============================ PACKAGES SETUP =================================
const fs = require('fs');
const jimp = require('jimp');
const http = require('http');
const path = require('path');
const cors = require('cors');
const rimraf = require('rimraf');
const crypto = require('crypto');
const ytdl = require('ytdl-core');
const request = require('request');
const express = require('express');
const admin = require('firebase-admin');
const lineReader = require('line-reader');
const bodyParser = require('body-parser');
const stringify = require('csv-stringify');
const exec = require('child_process').execFile;
const removeDirectories = require('remove-empty-directories');
// ============================= GLOBALS SETUP =================================
var size = 100;
var maxFPS = 1;
var users = {};
var types = {};
var background;
var working = false;
var delAftr = false;
const app = express();
const server = http.createServer(app);
jimp.read("background.jpg", (err, image) => {
    background = image;
    console.log("Background ready!");
});
ensureDirectoryExistence("./processing/pictures/frame.png");
ensureDirectoryExistence("./processing/pictures/processed/frame.png");
// =============================== APP SETUP ===================================
app.use(bodyParser.urlencoded({
    extended: false
}));
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
tdb.ref("config").on("value", snap => {
    var config = snap.val();
    size = config.size;
    console.log("Size got updated to: " + size + "px!");
    maxFPS = config.maxFPS;
    console.log("maxFPS got updated to: " + maxFPS + " fps!");
    types = config.types;
    console.log("types got updated to: " + JSON.stringify(types));
    delAftr = config.delete;
    console.log("delAftr got updated to: " + delAftr);
});
tdb.ref("queue").on("child_added", (snap) => {
    handleQueue(snap);
});
tdb.ref("queue").on("child_removed", (snap) => {
    handleQueue(snap);
});
// ========================== ACTIVE FIREBASE FUNCTIONS ========================
function handleQueue(snap) {
    tdb.ref("queue").once("value", (snap) => {
        if (!snap.val()) return;
        var snapkey = Object.keys(snap.val())[0];
        var snapshot = snap.val()[snapkey];
        pQ(snapkey, ("New request: " + JSON.stringify(snapshot, null, 3) + " @ " + snapkey + ". Processing..."));
        if (working) {
            pQ(snapkey, "Other Process working... will trigger on finish later.");
        } else {
            working = true;
            handleTrainingDataPost(snapshot, snapkey, (done) => {
                if (!done) pQ(snapkey, "Invalid request. Deleted & Exited.", () => {
                    working = false;
                    tdb.ref("queue/" + snapkey).set(null);
                });
                else pQ(snapkey, "Request complete. Moved to history & exited.", () => {
                    tdb.ref("config/lastUpdated").set(Date.now());
                    tdb.ref("history/" + snapkey).set(snapshot, () => {
                        working = false;
                        tdb.ref("queue/" + snapkey).set(null);
                    });
                });
            });
        }
    });
}

function pQ(key, str, cb) {
    console.log(key + ":", str);
    tdb.ref("queue/" + key + "/status").set(str);
    if (cb) cb();
}
// ======================== YOUTUBE DOWNLOADER FUNCTIONS =======================
function handleTrainingDataPost(body, snapkey, cb) { // Download a video, convert it to frames, then upload the processed frames to firebase to train.
    var framesFolder = getRandomKey();
    var videoID = ytdl.getVideoID(body.url);
    var validVideo = ytdl.validateURL("youtube.com/watch?v=" + videoID);
    if (!validVideo) {
        pQ(snapkey, "No video found OR not a valid video with ID \"" + videoID + "\" from \"" + body.url + "\"");
        cb(false);
    } else downloadYoutubeVideo(videoID, framesFolder, snapkey, fps => {
        var framesDict = {};
        var length = (Object.keys(body).length - 1) / 5;
        console.log("body: " + JSON.stringify(body));
        console.log("length: " + length);
        if (length == 0) {
            pQ(snapkey, "No frames to get from the video ID \"" + videoID + "\" from \"" + body.url + "\"");
            cb(false);
        } else {
            for (var i = 1; i <= length; i++) {
                var pose = body["selectedPose" + i];
                if (framesDict[pose] === undefined) framesDict[pose] = [];
                framesDict[pose].push([
                    (parseInt(body["startTimeStampMin" + i]) * 60 + parseInt(body["startTimeStampSec" + i])) * fps,
                    (parseInt(body["endTimeStampMin" + i]) * 60 + parseInt(body["endTimeStampSec" + i])) * fps
                ]);
            }
            convertToFrames(framesDict, videoID, framesFolder, fps, snapkey, cb);
        }
    });
}

function convertToFrames(framesDict, id, folder, fps, snapkey, cb) { // ffmpeg -i video.mp4 -vf select='eq(n\,30)+eq(n\,31)' -vsync 0 frames+"selectedPose"+%d.jpg
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
        framesDict[pose].forEach(frame => {
            for (var i = frame[0]; i <= frame[1]; i += (fps / maxFPS)) framesList += "eq(n\\," + i + ")+";
        });
        framesList = framesList.slice(0, -1);
        pQ(snapkey, "Putting framesList frames for " + pose + " into " + id + "/" + folder);
        console.log("framesList: " + framesList);
        exec('ffmpeg', [
            '-i', "./processing/videos/" + id + "/video.mp4",
            '-vf', 'select=\'' + framesList + '\'',
            '-vsync', '0', "./processing/videos/" + id + "/" + folder + "/" + pose + "%d.jpg"
        ], (error, stdout, stderr) => {
            completion[pose] = true;
            pQ(snapkey, "Finished " + pose + " pose for " + id + " @ " + folder + " in " + (Date.now() - time) + "ms!");
            checkFramesCompleteAndFlip(completion, id, folder, time, snapkey, cb);
        });
    }
}

function checkFramesCompleteAndFlip(check, video, folder, time, snapkey, cb) {
    for (const pose of Object.keys(check))
        if (!check[pose]) return;
    var completion = {};
    pQ(snapkey, "All frames for video " + video + " at folder " + folder + " have been extracted after " + (Date.now() - time) + "ms! Flipping...");
    fs.readdir("./processing/videos/" + video + "/" + folder, (err, files) => {
        files.forEach(file => {
            if (path.extname(file) != ".jpg") return;
            file = file.slice(0, -(".jpg".length));
            completion[file] = false;
        });
        files.forEach(file => {
            if (path.extname(file) != ".jpg") return;
            file = file.slice(0, -(".jpg".length));
            console.log("Flipping image " + file + ".jpg after " + (Date.now() - time) + "ms...");
            flipImage("./processing/videos/" + video + "/" + folder + "/" + file, ".jpg", () => {
                console.log("Finished flipping " + file + ".jpg after " + (Date.now() - time) + "ms!");
                completion[file] = true;
                processFrames(video, folder, completion, time, snapkey, cb);
            });
        });
    });
}

function processFrames(video, folder, check, time, snapkey, cb) {
    for (const flip of Object.keys(check))
        if (!check[flip]) return;
    pQ(snapkey, "Finished flipping frames for video " + video + " at folder " + folder + " after " + (Date.now() - time) + "ms! Running Openpose on them...");
    var time = Date.now();
    var completion = {};
    runOpenPose("./processing/videos/" + video + "/" + folder, "", snapkey, () => {
        fs.readdir("./processing/videos/" + video + "/" + folder, (err, files) => {
            files.forEach(file => {
                if (path.extname(file) != ".jpg") return;
                file = file.slice(0, -(".jpg".length));
                completion[file] = false;
            });
        });
        fs.readdir("./processing/videos/" + video + "/" + folder, (err, files) => {
            files.forEach(file => {
                if (path.extname(file) != ".jpg") return;
                file = file.slice(0, -(".jpg".length));
                console.log("Processing file " + file + " after " + (Date.now() - time) + "ms...");
                fs.readFile("./processing/videos/" + video + "/" + folder + "/" + file + "_keypoints.json", 'utf8', (err, data) => {
                    console.log("Finished reading file " + file + " json after " + (Date.now() - time) + "ms. Processing images...");
                    uploadFrameData(video, folder, file, extractData(JSON.parse(data)), time, (valid) => {
                        if (!valid) delete completion[file];
                        else completion[file] = true;
                        checkReqComplete(completion, video, folder, snapkey, cb);
                    });
                });
            });
        });
    });
}

function uploadFrameData(video, folder, file, openPoseData, time, cb) {
    if (openPoseData[1] == 0 || openPoseData[1] == 1) {
        console.log("File " + file + " is invalid. Skipping...");
        cb(false);
    } else imageProcessing("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg", openPoseData[0][0], openPoseData[0][1], openPoseData[0][2], openPoseData[0][3], (err, trainingImage, dims) => {
        openPoseFrameProcessing("./processing/videos/" + video + "/" + folder + "/" + file + "_rendered.png", dims, (err, openposeImage) => {
            console.log("Finished processing file " + file + " images after " + (Date.now() - time) + "ms. Uploading data...");
            var newData = {
                "timestamp": Date.now(),
                "key": video + "-" + folder + "-" + file,
                "pose": readPose(file),
                "trainingFrame": trainingImage, // <- BASE 64 OF 100x100 grayscaled and cropped training images
                "openposeFrame": openposeImage, // <- BASE 64 OF ?x100 resized openpose output images
            };
            for (var type in openPoseData)
                if (type > 0) newData["datatype" + type] = openPoseData[type];
            tdb.ref("frames/" + video + "-" + folder + "-" + file).set(newData, err => {
                console.log("Finished uploading file " + file + " data after " + (Date.now() - time) + "ms.");
                cb(true);
            });
        });
    });
}

function checkReqComplete(completion, video, folder, snapkey, cb) {
    for (const done of Object.keys(completion))
        if (!completion[done]) return;
    pQ(snapkey, "Finished request " + video + "/" + folder + ". " + (delAftr ? "Deleting the directory now..." : ""));
    if (delAftr) rimraf("./processing/videos/" + video + "/" + folder, () => {
        pQ(snapkey, "Deleted the processing folder...");
        cb(true);
    });
    else cb(true);
}

function downloadYoutubeVideo(url, folder, snapkey, callback) { // Check if a video is downloaded and then download it, or skip ahead
    var dirStart = "./processing/videos/" + url + "/video_writing.mp4";
    var dirDone = "./processing/videos/" + url + "/video.mp4";
    ensureDirectoryExistence(dirDone);
    if (!fs.existsSync(dirDone)) {
        pQ(snapkey, "Found and downloading video " + url + " frames to folder " + folder + " at " + size + "px");
        var time = Date.now();
        var videoDownload = fs.createWriteStream(dirStart);
        ytdl("youtube.com/watch?v=" + url, {
            quality: 'highestvideo',
            filter: format => format.container === 'mp4' && format.audioEncoding === null
        }).pipe(videoDownload);
        videoDownload.on('open', data => {
            pQ(snapkey, "Started downloading video " + url + " after " + (Date.now() - time) + "ms");
        });
        videoDownload.on('error', data => {
            pQ(snapkey, "Video " + url + " FAILED TO DOWNLOAD after " + (Date.now() - time) + "ms");
        });
        videoDownload.on('finish', () => {
            fs.rename(dirStart, dirDone, err => {
                pQ(snapkey, "Finished downloading video " + url + " after " + (Date.now() - time) + "ms");
                getFPS(dirDone, callback);
            });
        });
    } else {
        pQ(snapkey, "Video " + url + " was already downloaded!");
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
// ==================== OPENPOSE + DATA PROCESSING FUNCTIONS ===================
function runOpenPose(dir, outDir, snapkey, cb) { // OpenPoseDemo.exe --image_dir [DIRECTORY] --write_images [DIRECTORY] --write_keypoint_json [DIRECTORY] --no_display
    var time = Date.now();
    if (outDir == "") outDir = dir;
    console.log("Running openPoseDemo on \"" + dir + "\" outputting to \"" + outDir + "\"...");
    exec("openPoseDemo", ["--image_dir", dir,
        "--write_images", outDir,
        "--write_keypoint_json", outDir,
        "--no_display"
    ], (error, stdout, stderr) => {
        pQ(snapkey, "Finished running openPoseDemo in " + (Date.now() - time) + "ms @ " + dir + " to " + outDir + "; processing files and uploading them now...");
        cb();
    });
}
// Main extract data method that takes in poseData and returns array of data
function extractData(poseData) {
    var output = [
        [280, 0, 1000, 720], //DEFAULT CROP DIMENSIONS
        0, // 0, 1, OR ARRAY OF RELATIVE MAGNITUDES; MAKE CO-ORDINATES RELATIVE TO 0 -> 1, AND THEN FIND MAGNITUDES OF EACH POINTS FROM A AVERAGE POINT OF ALL POINTS
        0, // 0, 1, OR ARRAY OF RELATIVE CO-ORDINATE POSITIONS [X1, Y1, X2, Y2, ..., XN, YN], XN AND YN ARE BETWEEN 0 - 1
        0, // 0, 1, OR ARRAY OF ANGLES BASED ON YOUR OLD METHOD THAT MIGHT BE DIRECTION AGNOSTIC
        0 // 0, 1, OR ARRAY OF ANGLES AND MAGNITUDES CONCATENATED
        //0, // ANY OTHER WAYS WE CAN THINK OF GATHERING MEANING FROM OPEN POSE, MAYBE ANGLES BASED ON THE NEW WEBSITE WE FOUND?
    ];
    if (poseData.people.length == 0) return output; // Return 0s for nobody in frame
    output[1] = output[2] = output[3] = output[4] = 1;
    var personIndex = -1;
    for (var p = poseData.people.length - 1; p > -1; p--) {
        personIndex = p;
        for (var i = 3; i < 42; i++) // Change personIndex back to -1 if person data is incomplete
            if (poseData.people[p].pose_keypoints[i] == 0) personIndex = -1;
    }
    if (personIndex == -1) return output; // Return 1s for incomplete person in frame
    var keypoints = poseData.people[personIndex].pose_keypoints;
    output[0] = getCropData(keypoints); //Get crop data
    output[1] = extractMagnitudes(keypoints, output[0][2] - output[0][0]); //Relative magnitudes
    output[2] = extractRelativeCoordinates(keypoints, output[0]); //Relative coordinates
    output[3] = extractAngleRelativeToLine(keypoints); //Angle relative to vertical line
    output[4] = output[3].concat(output[1]); //Concat of relative angles to vertical line and relative magnitudes
    output[5] = output[3].concat(output[1].concat(output[2])); //Concat of relative angles and relative magnitudes and relative positions
    return output;
}
// Finds cropping dimensions for pose image.
// Inputs keypoints array from a JSON output from openpose
// Return [Upper left X coord, Upper left Y coord, Lower right X coord, Lower right Y coord]
// If no pose is found, return [280, 0, 1000, 720], a default center square for 720p webcams
// Note:   Does not guarantee that the coords are within original image dimensions.
//         Pads so the crop dimensions are square.
//         THIS DOES NOT GUARANTEE THAT THE COORDINATES ARE VALID (i.e. negative coords are possible)
function getCropData(keypoints) {
    var xMax = -Infinity;
    var xMin = Infinity;
    var yMax = -Infinity;
    var yMin = Infinity;
    for (i = 0; i < keypoints.length; i += 3) {
        if (keypoints[i] != 0 && xMin > keypoints[i]) xMin = keypoints[i];
        if (keypoints[i] != 0 && xMax < keypoints[i]) xMax = keypoints[i];
    }
    for (i = 1; i < keypoints.length; i += 3) {
        if (keypoints[i] != 0 && yMax < keypoints[i]) yMax = keypoints[i];
        if (keypoints[i] != 0 && yMin > keypoints[i]) yMin = keypoints[i];
    }
    xMax += 50;
    xMin -= 50;
    yMax += 50;
    yMin -= 50;
    var width = xMax - xMin;
    var height = yMax - yMin;
    if (width < height) {
        xMin -= (height - width) / 2;
        xMax += (height - width) / 2;
    } else if (width > height) {
        yMin -= (width - height) / 2;
        yMax += (width - height) / 2;
    }
    return [xMin, yMin, xMax, yMax].map(x => Math.round(x));
}
// Input: Keypoint array from Openpose JSON; Assumes it's complete and exists
// Output: Array of scaled magnitudes trimmed to 5 decimal places; Scale is magnitude / pose width
function extractMagnitudes(keypoints, size) {
    var avgX = 0;
    var avgY = 0;
    for (var i = 1; i <= 13; i++) {
        avgX += keypoints[i * 3];
        avgY += keypoints[i * 3 + 1];
    }
    avgX = avgX / 13;
    avgY = avgY / 13;
    return [
        parseFloat((magnitude(keypoints[15], keypoints[16], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[6], keypoints[7], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[18], keypoints[19], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[9], keypoints[10], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[21], keypoints[22], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[12], keypoints[13], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[33], keypoints[34], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[24], keypoints[25], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[36], keypoints[37], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[27], keypoints[28], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[39], keypoints[40], avgX, avgY) / size).toFixed(4)),
        parseFloat((magnitude(keypoints[30], keypoints[31], avgX, avgY) / size).toFixed(4))
    ];
}
// Return relative coords of keypoints [X1, Y1, X2, Y2, ...]
function extractRelativeCoordinates(keypoints, size) {
    var dimension = size[2] - size[0];
    var output = [];
    for (var i = 0; i <= 39; i += 3) {
        output.push(parseFloat(((keypoints[i] - size[1]) / dimension).toFixed(4)));
        output.push(parseFloat(((keypoints[i + 1] - size[0]) / dimension).toFixed(4)));
    }
    return output;
}
// Return relative coords of keypoints [Angle1, Angle2, Angle3, ...]
function extractAngleRelativeToLine(keypoints) {
    return [
        AngleRelativeToLine(keypoints[3], keypoints[4], keypoints[15], keypoints[16]),
        AngleRelativeToLine(keypoints[3], keypoints[4], keypoints[6], keypoints[7]),
        AngleRelativeToLine(keypoints[15], keypoints[16], keypoints[18], keypoints[19]),
        AngleRelativeToLine(keypoints[6], keypoints[7], keypoints[9], keypoints[10]),
        AngleRelativeToLine(keypoints[18], keypoints[19], keypoints[21], keypoints[22]),
        AngleRelativeToLine(keypoints[9], keypoints[10], keypoints[12], keypoints[13]),
        AngleRelativeToLine(keypoints[3], keypoints[4], keypoints[33], keypoints[34]),
        AngleRelativeToLine(keypoints[3], keypoints[4], keypoints[24], keypoints[25]),
        AngleRelativeToLine(keypoints[33], keypoints[34], keypoints[36], keypoints[37]),
        AngleRelativeToLine(keypoints[24], keypoints[25], keypoints[27], keypoints[28]),
        AngleRelativeToLine(keypoints[36], keypoints[37], keypoints[39], keypoints[40]),
        AngleRelativeToLine(keypoints[27], keypoints[28], keypoints[30], keypoints[31]),
    ];
}
// ======================== IMAGE PROCESSING FUNCTIONS ========================
function imageProcessing(path, x1, y1, x2, y2, cb) {
    var bg = background.clone();
    jimp.read(path, (err, image) => {
        if (err) {
            cb(false);
            console.log(err);
        } else bg.resize((x2 - x1), (y2 - y1)) // Resizes the 1x1 Gray to the size we need it
            .composite(image, -x1, -y1) //Composite the image to have no Grey
            .resize(size, size) //resize to 100 x 100
            .greyscale() // greyscale
            .quality(100) // set JPEG quality
            .getBase64(bg.getMIME(), (err, trainingImage) => { // return trainingImage as base64 in passed in callback
                cb(err, trainingImage, [image.bitmap.width, image.bitmap.height]);
            });
    });
}

function flipImage(path, ext, cb) {
    jimp.read(path + ext, (err, image) => {
        if (err) {
            cb(false)
            console.log(err);
        } else image.flip(true, false)
            .write(path + "_flipped" + ext, cb);
    });
}

function openPoseFrameProcessing(path, dims, cb) {
    if (!dims) jimp.read(path, (err, image) => {
        if (err) {
            cb(false)
            console.log(err);
        } else image.resize(jimp.AUTO, size)
            .quality(100)
            .getBase64(image.getMIME(), cb);
    });
    else jimp.read(path, (err, image) => {
        var imgasprtio = image.bitmap.width / image.bitmap.height;
        var dimasprtio = dims[0] / dims[1];
        if (err) cb(false);
        else image
            .crop(0, 0, (((dimasprtio <= imgasprtio) ? (dimasprtio / imgasprtio) : 1) * image.bitmap.width), (((imgasprtio <= dimasprtio) ? (imgasprtio / dimasprtio) : 1) * image.bitmap.height))
            .resize(jimp.AUTO, size)
            .quality(100)
            .getBase64(image.getMIME(), cb);
    });
}
// ============================= HELPER FUNCTIONS ==============================
function ensureDirectoryExistence(filePath) {
    var dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) return true;
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

function delFrame(video, folder, file) {
    delFile("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg", () => {});
    delFile("./processing/videos/" + video + "/" + folder + "/" + file + "_flipped.jpg", () => {});
    delFile("./processing/videos/" + video + "/" + folder + "/" + file + "_rendered.png", () => {});
    delFile("./processing/videos/" + video + "/" + folder + "/" + file + "_flipped_rendered.png", () => {});
    delFile("./processing/videos/" + video + "/" + folder + "/" + file + "_keypoints.json", () => {});
    delFile("./processing/videos/" + video + "/" + folder + "/" + file + "_flipped_keypoints.json", () => {});
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
    else if (name.toLowerCase().includes("none")) return "none";
    else return false;
}

function magnitude(x1, y1, x2, y2) { //Returns absolute distance between two (X,Y) coordinates
    return Math.abs(Math.pow((Math.pow((x2 - x1), 2) + Math.pow((y2 - y1), 2)), 0.5));
}

function radiansToDegrees(radians) {
    return (radians * 180 / Math.PI);
}

function degreesToRadians(degrees) {
    return (degrees * Math.PI / 180);
}
/*
Returns an angle between two points relative to a straight line going up.
This makes it so angles can be mirrored easily.
To mirror angles, swap L/R limbs and multiply by -1

Angle is determined as the following:

    O
  --+--
    |
   / \

Degree  Shape (points 1 and 2)
-------------
        2
0       |
        1
-------------
        | 2
45      |/
        1
-------------
      2 |
-45    \|
        1
-------------
        1
180     |
        2
-------------
        1
135     |\
        | 2
-------------
        1
-135   /|
      2 |
-------------
*/
function AngleRelativeToLine(x1, y1, x2, y2) {
    var angle = Math.round(radiansToDegrees(Math.acos((y2 - y1) / Math.pow((Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)), 0.5))));
    return (x2 > x1) ? angle : -angle;
}