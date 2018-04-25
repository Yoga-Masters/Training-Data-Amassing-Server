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
// console.log(extractData(JSON.parse('{"version":1.0, "people":[{ "pose_keypoints":[ 0,0,0,950.986,416.702,0.821036,1091.73,431.277,0.753385,1176.79,598.792,0.714243,1226.72,707.304,0.522699,810.112,407.989,0.760693,730.726,589.916,0.640745,692.542,669.24,0.539292,1030.09,804.064,0.418698,1282.54,721.966,0.609444,1540.79,739.509,0.649982,871.622,810.069,0.456652,642.641,689.547,0.800972,431.517,721.958,0.750155,0,0,0,0,0,0,1018.46,261.233,0.795286,880.386,270.043,0.749068], "face_keypoints":[ ], "hand_left_keypoints":[ ], "hand_right_keypoints":[ ] } ]}')));
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
adb.ref("size").on("value", snap => {
    size = snap.val();
    console.log("Size got updated to: " + size + "px!");
});
adb.ref("maxFPS").on("value", snap => {
    maxFPS = snap.val();
    console.log("maxFPS got updated to: " + maxFPS + " fps!");
});
tdb.ref("types").on("value", snap => {
    types = snap.val();
    console.log("types got updated to: " + JSON.stringify(types));
});
tdb.ref("delete").on("value", snap => {
    delAftr = snap.val();
    console.log("delAftr got updated to: " + delAftr);
});
tdb.ref("queue").on("value", (snap) => { // TODO: ADD A STATUS TO THE QUE THAT IS UPDATED AS THE THING MOVES ALONG, AND GETS DELETED WHEN MOVED INTO HISTORY
    if (!snap.val()) return;
    var snapKey = Object.keys(snap.val())[0];
    var snapshot = snap.val()[snapKey];
    console.log("New request:", snapshot, "@", snapKey, "...processing...");
    if (working) {
        console.log("Other Process working... will trigger on finish later.");
    } else {
        working = true;
        handleTrainingDataPost(snapshot, (done) => {
            if (!done) {
                console.log("Invalid request. Deleted & Exited.");
                working = false;
                tdb.ref("queue/" + snapKey).set(null);
            } else {
                tdb.ref("lastUpdated").set(Date.now());
                tdb.ref("history/" + snapKey).set(snapshot, () => {
                    working = false;
                    tdb.ref("queue/" + snapKey).set(null, () => {
                        console.log("Request complete. Moved to history & exited.");
                    });
                });
            }
        });
    }
});
// ======================== YOUTUBE DOWNLOADER FUNCTIONS =======================
function handleTrainingDataPost(body, cb) { // Download a video, convert it to frames, then upload the processed frames to firebase to train.
    var framesFolder = getRandomKey();
    var videoID = ytdl.getVideoID(body.url);
    var validVideo = ytdl.validateURL("youtube.com/watch?v=" + videoID);
    if (!validVideo) {
        console.log("No video found OR not a valid video with ID \"" + videoID + "\" from \"" + body.url + "\"");
        cb(false);
    } else downloadYoutubeVideo(videoID, framesFolder, fps => {
        var framesDict = {};
        var length = (Object.keys(body).length - 1) / 5;
        console.log("body: " + JSON.stringify(body));
        console.log("length: " + length);
        if (length == 0) {
            console.log("No frames to get from the video ID \"" + videoID + "\" from \"" + body.url + "\"");
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
            convertToFrames(framesDict, videoID, framesFolder, fps, cb);
        }
    });
}

function convertToFrames(framesDict, id, folder, fps, cb) { // ffmpeg -i video.mp4 -vf select='eq(n\,30)+eq(n\,31)' -vsync 0 frames+"selectedPose"+%d.jpg
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
        console.log("Putting framesList frames for " + pose + " into " + id + "/" + folder);
        console.log("framesList: " + framesList);
        exec('ffmpeg', [
            '-i', "./processing/videos/" + id + "/video.mp4",
            '-vf', 'select=\'' + framesList + '\'',
            '-vsync', '0', "./processing/videos/" + id + "/" + folder + "/" + pose + "%d.jpg"
        ], (error, stdout, stderr) => {
            completion[pose] = true;
            console.log("Finished " + pose + " pose for " + id + " @ " + folder + " in " + (Date.now() - time) + "ms!");
            checkFramesCompleteAndFlip(completion, id, folder, time, cb);
        });
    }
}

function checkFramesCompleteAndFlip(check, video, folder, time, cb) {
    for (const pose of Object.keys(check))
        if (!check[pose]) return;
    var completion = {};
    console.log("All frames for video " + video + " at folder " + folder + " have been extracted after " + (Date.now() - time) + "ms! Flipping then Running Openpose on them...");
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
                processFrames(video, folder, completion, cb);
            });
        });
    });
}

function processFrames(video, folder, check, cb) {
    for (const flip of Object.keys(check))
        if (!check[flip]) return;
    var time = Date.now();
    var completion = {};
    runOpenPose("./processing/videos/" + video + "/" + folder, "", () => {
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
                        checkReqComplete(completion, video, folder, cb);
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
    } else imageProcessing("./processing/videos/" + video + "/" + folder + "/" + file + ".jpg", openPoseData[0][0], openPoseData[0][1], openPoseData[0][2], openPoseData[0][3], (err, trainingImage) => {
        openPoseFrameProcessing(("./processing/videos/" + video + "/" + folder + "/" + file + "_rendered.png"), (err, openposeImage) => {
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

function checkReqComplete(completion, video, folder, cb) {
    for (const done of Object.keys(completion))
        if (!completion[done]) return;
    console.log("Finished request " + video + "/" + folder + ". " + (delAftr ? "Deleting the directory now..." : ""));
    if (delAftr) rimraf("./processing/videos/" + video + "/" + folder, () => {
        console.log("Deleted the processing folder...");
        cb(true);
    });
    else cb(true);
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
    } else {
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
// ==================== OPENPOSE + DATA PROCESSING FUNCTIONS ===================
function runOpenPose(dir, outDir, callback) { // OpenPoseDemo.exe --image_dir [DIRECTORY] --write_images [DIRECTORY] --write_keypoint_json [DIRECTORY] --no_display
    var time = Date.now();
    if (outDir == "") outDir = dir;
    console.log("Running openPoseDemo on \"" + dir + "\" outputting to \"" + outDir + "\"...");
    exec("openPoseDemo", ["--image_dir", dir,
        "--write_images", outDir,
        "--write_keypoint_json", outDir,
        "--no_display"
    ], (error, stdout, stderr) => {
        console.log("Finished running openPoseDemo in " + (Date.now() - time) + "ms @ " + dir + " to " + outDir + "; processing files now...");
        callback();
    });
}

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
    return output;
}
/*
    Finds cropping dimensions for pose image.
    Inputs keypoints array from a JSON output from openpose
    Return [Upper left X coord,
            Upper left Y coord,
            Lower right X coord.
            Lower right Y coord]
    If no pose is found, return [280, 0, 1000, 720], a default center square for 720p webcams
    Note:
        Does not guarantee that the coords are within original image dimensions.
        Pads so the crop dimensions are square.
        THIS DOES NOT GUARANTEE THAT THE COORDINATES ARE VALID (i.e. negative coords are possible)
*/
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
/*
    Input: Keypoint array from Openpose JSON; Assumes it's complete and exists
    Output: Array of scaled magnitudes trimmed to 5 decimal places; Scale is magnitude / pose width
*/
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
/*
    Return relative coords of keypoints
    [X1, Y1, X2, Y2, ...]
*/
function extractRelativeCoordinates(keypoints, size) {
    var dimension = size[2] - size[0];
    var output = [];
    for (var i = 0; i <= 39; i += 3) {
        output.push(parseFloat(((keypoints[i] - size[1]) / dimension).toFixed(4)));
        output.push(parseFloat(((keypoints[i + 1] - size[0]) / dimension).toFixed(4)));
    }
    return output;
}
/*
    Return relative coords of keypoints
    [Angle1, Angle2, Angle3, ...]
*/
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
            cb(false)
            console.log(err);
        } else bg.resize((x2 - x1), (y2 - y1)) // Resizes the 1x1 Gray to the size we need it
            .composite(image, -x1, -y1) //Composite the image to have no Grey
            .resize(size, size) //resize to 100 x 100
            .quality(100) // set JPEG quality
            .greyscale() // greyscale
            .getBase64(jimp.MIME_JPEG, cb); // return image as base64 in passed in callback
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

function openPoseFrameProcessing(path, cb) {
    jimp.read(path, (err, image) => {
        if (err) {
            cb(false)
            console.log(err);
        } else image.resize(jimp.AUTO, size)
            .quality(100)
            .getBase64(jimp.MIME_JPEG, cb);
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
// ---------
// older version that updates everything
// function handleAppDataUpdating(user, ext, time) {
//     for (const user of Object.keys(users)) {
//         console.log("Starting reading files for " + user + " after " + (Date.now() - time) + "ms...");
//         if (!users[user]) return;
//         else fs.readFile("./processing/pictures/processed/" + user + "_keypoints.json", 'utf8', (err, data) => {
//             console.log("Finished reading file " + user + " json after " + (Date.now() - time) + "ms. Processing image...");
//             var openPoseData = extractAngles(JSON.parse(data));
//             if (openPoseData[0] == 0 || openPoseData[0] == 1) return;
//             else imageProcessing("./processing/pictures/" + user + "." + ext, openPoseData[1][0], openPoseData[1][1], openPoseData[1][2], openPoseData[1][3], (err, trainingImage) => {
//                 openPoseFrameProcessing(("./processing/pictures/processed" + user + ".jpg"), (err, openposeImage) => {
//                     console.log("Finished processing file " + user + " images after " + (Date.now() - time) + "ms. Uploading data...");
//                     adb.ref("users/" + user).update({
//                         "lastUpdated": Date.now(),
//                         "latestOpenPoseFrame": openposeImage,
//                         "latestTensorData/angles": openPoseData[0],
//                         "latestTensorData/latestProcessedFrame": trainingImage
//                     });
//                 });
//             });
//         });
//     }
// }
// ---------
// function processFrames(video, folder, openPosed) {
//     var time = Date.now();
//     var ".jpg" = ".json";
//     var pg" =  = "_keypoints.json";
//     if (!openPosed) {
//         ".jpg" = ".jpg";
//         pg" =  = ".jpg";
//     }
//     fs.readdir("./processing/videos/" + video + "/" + folder + "/", (err, files) => {
//         // var completion = {};
//         // files.forEach(file => {
//         //     if (path.extname(file) != ".jpg") return;
//         //     completion[file.slice(0, ".jpg"(fileEnd.length))] = false;
//         // });
//         files.forEach(file => {
//             if (path.extname(file) != ".jpg") return;
//             file = file.slice(0, -(".jpg".length));
//             console.log("Processing file " + file + " after " + (Date.now() - time) + "ms...");
//             if (!openPosed) uploadFrameData(video, folder, file, extractAngles({}), time);
//             else fs.readFile("./processing/videos/" + video + "/" + folder + "/" + file + "_keypoints.json", 'utf8', (err, data) => {
//                 uploadFrameData(video, folder, file, extractAngles(JSON.parse(data)), time);
//             });
//         });
//     });
// }
// ---- OLD CODE TO CREATE JS AND CSV DATA DOWNLOAD FILES -----
// var jsonDATA = "const DEFAULT_CLASSES = ['Iris-setosa', 'Iris-versicolor', 'Iris-virginica'];\nconst DEFAULT_NUM_CLASSES = DEFAULT_CLASSES.length;\nconst DEFAULT_DATA = [[5.1, 3.5, 1.4, 0.2, 0], [4.9, 3.0, 1.4, 0.2, 0], [4.7, 3.2, 1.3, 0.2, 0], [4.6, 3.1, 1.5, 0.2, 0], [5.0, 3.6, 1.4, 0.2, 0], [5.4, 3.9, 1.7, 0.4, 0], [4.6, 3.4, 1.4, 0.3, 0], [5.0, 3.4, 1.5, 0.2, 0], [4.4, 2.9, 1.4, 0.2, 0], [4.9, 3.1, 1.5, 0.1, 0], [5.4, 3.7, 1.5, 0.2, 0], [4.8, 3.4, 1.6, 0.2, 0], [4.8, 3.0, 1.4, 0.1, 0], [4.3, 3.0, 1.1, 0.1, 0], [5.8, 4.0, 1.2, 0.2, 0], [5.7, 4.4, 1.5, 0.4, 0], [5.4, 3.9, 1.3, 0.4, 0], [5.1, 3.5, 1.4, 0.3, 0], [5.7, 3.8, 1.7, 0.3, 0], [5.1, 3.8, 1.5, 0.3, 0], [5.4, 3.4, 1.7, 0.2, 0], [5.1, 3.7, 1.5, 0.4, 0], [4.6, 3.6, 1.0, 0.2, 0], [5.1, 3.3, 1.7, 0.5, 0], [4.8, 3.4, 1.9, 0.2, 0], [5.0, 3.0, 1.6, 0.2, 0], [5.0, 3.4, 1.6, 0.4, 0], [5.2, 3.5, 1.5, 0.2, 0], [5.2, 3.4, 1.4, 0.2, 0], [4.7, 3.2, 1.6, 0.2, 0], [4.8, 3.1, 1.6, 0.2, 0], [5.4, 3.4, 1.5, 0.4, 0], [5.2, 4.1, 1.5, 0.1, 0], [5.5, 4.2, 1.4, 0.2, 0], [4.9, 3.1, 1.5, 0.1, 0], [5.0, 3.2, 1.2, 0.2, 0], [5.5, 3.5, 1.3, 0.2, 0], [4.9, 3.1, 1.5, 0.1, 0], [4.4, 3.0, 1.3, 0.2, 0], [5.1, 3.4, 1.5, 0.2, 0], [5.0, 3.5, 1.3, 0.3, 0], [4.5, 2.3, 1.3, 0.3, 0], [4.4, 3.2, 1.3, 0.2, 0], [5.0, 3.5, 1.6, 0.6, 0], [5.1, 3.8, 1.9, 0.4, 0], [4.8, 3.0, 1.4, 0.3, 0], [5.1, 3.8, 1.6, 0.2, 0], [4.6, 3.2, 1.4, 0.2, 0], [5.3, 3.7, 1.5, 0.2, 0], [5.0, 3.3, 1.4, 0.2, 0], [7.0, 3.2, 4.7, 1.4, 1], [6.4, 3.2, 4.5, 1.5, 1], [6.9, 3.1, 4.9, 1.5, 1], [5.5, 2.3, 4.0, 1.3, 1], [6.5, 2.8, 4.6, 1.5, 1], [5.7, 2.8, 4.5, 1.3, 1], [6.3, 3.3, 4.7, 1.6, 1], [4.9, 2.4, 3.3, 1.0, 1], [6.6, 2.9, 4.6, 1.3, 1], [5.2, 2.7, 3.9, 1.4, 1], [5.0, 2.0, 3.5, 1.0, 1], [5.9, 3.0, 4.2, 1.5, 1], [6.0, 2.2, 4.0, 1.0, 1], [6.1, 2.9, 4.7, 1.4, 1], [5.6, 2.9, 3.6, 1.3, 1], [6.7, 3.1, 4.4, 1.4, 1], [5.6, 3.0, 4.5, 1.5, 1], [5.8, 2.7, 4.1, 1.0, 1], [6.2, 2.2, 4.5, 1.5, 1], [5.6, 2.5, 3.9, 1.1, 1], [5.9, 3.2, 4.8, 1.8, 1], [6.1, 2.8, 4.0, 1.3, 1], [6.3, 2.5, 4.9, 1.5, 1], [6.1, 2.8, 4.7, 1.2, 1], [6.4, 2.9, 4.3, 1.3, 1], [6.6, 3.0, 4.4, 1.4, 1], [6.8, 2.8, 4.8, 1.4, 1], [6.7, 3.0, 5.0, 1.7, 1], [6.0, 2.9, 4.5, 1.5, 1], [5.7, 2.6, 3.5, 1.0, 1], [5.5, 2.4, 3.8, 1.1, 1], [5.5, 2.4, 3.7, 1.0, 1], [5.8, 2.7, 3.9, 1.2, 1], [6.0, 2.7, 5.1, 1.6, 1], [5.4, 3.0, 4.5, 1.5, 1], [6.0, 3.4, 4.5, 1.6, 1], [6.7, 3.1, 4.7, 1.5, 1], [6.3, 2.3, 4.4, 1.3, 1], [5.6, 3.0, 4.1, 1.3, 1], [5.5, 2.5, 4.0, 1.3, 1], [5.5, 2.6, 4.4, 1.2, 1], [6.1, 3.0, 4.6, 1.4, 1], [5.8, 2.6, 4.0, 1.2, 1], [5.0, 2.3, 3.3, 1.0, 1], [5.6, 2.7, 4.2, 1.3, 1], [5.7, 3.0, 4.2, 1.2, 1], [5.7, 2.9, 4.2, 1.3, 1], [6.2, 2.9, 4.3, 1.3, 1], [5.1, 2.5, 3.0, 1.1, 1], [5.7, 2.8, 4.1, 1.3, 1], [6.3, 3.3, 6.0, 2.5, 2], [5.8, 2.7, 5.1, 1.9, 2], [7.1, 3.0, 5.9, 2.1, 2], [6.3, 2.9, 5.6, 1.8, 2], [6.5, 3.0, 5.8, 2.2, 2], [7.6, 3.0, 6.6, 2.1, 2], [4.9, 2.5, 4.5, 1.7, 2], [7.3, 2.9, 6.3, 1.8, 2], [6.7, 2.5, 5.8, 1.8, 2], [7.2, 3.6, 6.1, 2.5, 2], [6.5, 3.2, 5.1, 2.0, 2], [6.4, 2.7, 5.3, 1.9, 2], [6.8, 3.0, 5.5, 2.1, 2], [5.7, 2.5, 5.0, 2.0, 2], [5.8, 2.8, 5.1, 2.4, 2], [6.4, 3.2, 5.3, 2.3, 2], [6.5, 3.0, 5.5, 1.8, 2], [7.7, 3.8, 6.7, 2.2, 2], [7.7, 2.6, 6.9, 2.3, 2], [6.0, 2.2, 5.0, 1.5, 2], [6.9, 3.2, 5.7, 2.3, 2], [5.6, 2.8, 4.9, 2.0, 2], [7.7, 2.8, 6.7, 2.0, 2], [6.3, 2.7, 4.9, 1.8, 2], [6.7, 3.3, 5.7, 2.1, 2], [7.2, 3.2, 6.0, 1.8, 2], [6.2, 2.8, 4.8, 1.8, 2], [6.1, 3.0, 4.9, 1.8, 2], [6.4, 2.8, 5.6, 2.1, 2], [7.2, 3.0, 5.8, 1.6, 2], [7.4, 2.8, 6.1, 1.9, 2], [7.9, 3.8, 6.4, 2.0, 2], [6.4, 2.8, 5.6, 2.2, 2], [6.3, 2.8, 5.1, 1.5, 2], [6.1, 2.6, 5.6, 1.4, 2], [7.7, 3.0, 6.1, 2.3, 2], [6.3, 3.4, 5.6, 2.4, 2], [6.4, 3.1, 5.5, 1.8, 2], [6.0, 3.0, 4.8, 1.8, 2], [6.9, 3.1, 5.4, 2.1, 2], [6.7, 3.1, 5.6, 2.4, 2], [6.9, 3.1, 5.1, 2.3, 2], [5.8, 2.7, 5.1, 1.9, 2], [6.8, 3.2, 5.9, 2.3, 2], [6.7, 3.3, 5.7, 2.5, 2], [6.7, 3.0, 5.2, 2.3, 2], [6.3, 2.5, 5.0, 1.9, 2], [6.5, 3.0, 5.2, 2.0, 2], [6.2, 3.4, 5.4, 2.3, 2], [5.9, 3.0, 5.1, 1.8, 2]];\n\n";
// var time = Date.now();
// var data = snap.val();
// var trainingData = {};
// var poseIndex = {
//     "warriorii": 0,
//     "tree": 1,
//     "triangle": 2
// };
// ensureDirectoryExistence("./client/test.data");
// for (const type in types) trainingData[type] = [];
// for (const key of Object.keys(data)) {
//     for (const type in types) {
//         if (data[key][type] && !(data[key][type] == 0 || data[key][type] == 1)) {
//             data[key][type].push(poseIndex[data[key].pose]);
//             trainingData[type].push(data[key][type]);
//         }
//     }
// }
// for (const type in types) {
//     var dType = types[type].toUpperCase();
//     jsonDATA += "const " + dType + "_CLASSES = " + JSON.stringify(Object.keys(poseIndex)) + ";\nconst " + dType + "_NUM_CLASSES = " + dType + "_CLASSES.length;\nconst " + dType + "_DATA = " + JSON.stringify(trainingData[type]) + ";\n\n";
// }
// jsonDATA += "const IRIS_CLASSES = DEFAULT_CLASSES;\nconst IRIS_NUM_CLASSES = DEFAULT_NUM_CLASSES;\nconst IRIS_DATA = DEFAULT_DATA;"
// fs.writeFile("./client/training_data.js", jsonDATA, 'utf8', err => {
//     console.log("Wrote all data types in json from scratch in " + (Date.now() - time) + "ms");
//     for (const type in types) stringify(trainingData[type], (err, output) => {
//         output = trainingData[type].length + "," + (trainingData[type][0].length - 1) + "," + Object.keys(poseIndex) + "\n" + output;
//         fs.writeFile("./client/training_" + types[type] + ".csv", output, 'utf8', err => {
//             tdb.ref("lastUpdated").set(Date.now());
//             console.log("Wrote " + types[type] + " data from scratch in " + (Date.now() - time) + "ms");
//         });
//     });
// });
// ---- OLD CODE TO HANDLE USERS FILES -----
// adb.ref("users").on("child_added", (snap, prevChildKey) => {
//     users[snap.val().key] = {"updating": snap.val().updating, "dimensions": snap.val().dimensions};
//     adb.ref("users/" + snap.val().key + "/updating").on("value", snap => {
//         users[snap.ref.parent.key].updating = snap.val();
//     });
//     adb.ref("users/" + snap.val().key + "/dimensions").on("value", snap => {
//         users[snap.ref.parent.key].dimensions = snap.val();
//     });
// });
// ---- OLD CODE TO ADD TO HISTORY FILE -----
// fs.appendFile('./client/history.txt', JSON.stringify(req.body) + "\n", err => {
//     console.log("Got a POST: " + JSON.stringify(req.body) + "\nSaved to history.txt!");
//     res.redirect('/');
// });
// ---- OLD ROUTING CODE THAT'S OBSOLETE NOW -----
// app.get('/api', (req, res) => res.send({
//     "return": 'Hello World @ Yoga Master - App & Training - Server DB API!'
// }));
// app.get('/api/getpost', (req, res) => {
//     console.log("Got a GET POST: " + req.query);
//     handleTrainingDataPost(req.query);
//     res.send({
//         "processing": req.query
//     });
// });
// app.get('/api/deleteKey/:key', (req, res) => {
//     tdb.ref("frames/" + req.params.key).set(null, () => {
//         res.send({
//             "return": "Deleted key " + req.params.key + " data!"
//         });
//     });
// });
// -------------------- OLD APP HANDLING PROCESSING FUNCTIONS --------------------
// function handleAppDataUpdating(user, ext, time) {
//     fs.readFile("./processing/pictures/processed/" + user + "_keypoints.json", 'utf8', (err, data) => {
//         console.log("Finished reading file " + user + " json after " + (Date.now() - time) + "ms. Processing image...");
//         if (!data) return;
//         var openPoseData = extractData(JSON.parse(data));
//         if (openPoseData[1] == 0 || openPoseData[1] == 1)
//             updateAppData(user, openPoseData, {}, time);
//         else imageProcessing("./processing/pictures/" + user + "." + ext, openPoseData[0][0], openPoseData[0][1], openPoseData[0][2], openPoseData[0][3], (err, trainingImage) => {
//             console.log("Openpose successfully found a whole person!");
//             updateAppData(user, openPoseData, {
//                 "latestTensorData/latestProcessedFrame": trainingImage
//             }, time);
//         });
//     });
// }
// function updateAppData(user, openPoseData, newData, time) {
//     openPoseFrameProcessing(("./processing/pictures/processed/" + user + "_rendered.png"), (err, openposeImage) => {
//         console.log("Finished processing file " + user + " images after " + (Date.now() - time) + "ms. Uploading data...");
//         newData["lastUpdated"] = Date.now();
//         newData["latestOpenPoseFrame"] = openposeImage;
//         for (var type in openPoseData)
//             if (type > 0) newData["latestTensorData/datatype" + type] = openPoseData[type];
//         adb.ref("users/" + user).update(newData);
//     });
// }
// -------------------- OLD FILE DELETING HANDLING CODE --------------------
// delFrame(video, folder, file);
// removeDirectories('./processing');
// if (delAftr) delFrame(video, folder, file);
// removeDirectories('./processing');
// --------------------- OLD HISTORY REDO HANDLING CODE --------------------
// var count = 0;
// lineReader.eachLine('history.txt', (line, last) => {
//     console.log("Started redownload of the processing folder using history.txt...");
//     request.post("localhost:" + server.address().port + "/postapi").form(JSON.parse(line)); //FIX FOR ALEX'S HOME SERVER
//     count++;
//     if (last) res.send({
//         "return": "ReDownloaded " + count + " requests!"
//     });
// });
// var l_shoulder = parseFloat((magnitude(keypoints[15], keypoints[16], avgX, avgY) / width).toFixed(4));
// var r_shoulder = parseFloat((magnitude(keypoints[6], keypoints[7], avgX, avgY) / width).toFixed(4));
// var l_arm = parseFloat((magnitude(keypoints[18], keypoints[19], avgX, avgY) / width).toFixed(4));
// var r_arm = parseFloat((magnitude(keypoints[9], keypoints[10], avgX, avgY) / width).toFixed(4));
// var l_farm = parseFloat((magnitude(keypoints[21], keypoints[22], avgX, avgY) / width).toFixed(4));
// var r_farm = parseFloat((magnitude(keypoints[12], keypoints[13], avgX, avgY) / width).toFixed(4));
// var l_spine = parseFloat((magnitude(keypoints[33], keypoints[34], avgX, avgY) / width).toFixed(4));
// var r_spine = parseFloat((magnitude(keypoints[24], keypoints[25], avgX, avgY) / width).toFixed(4));
// var l_thigh = parseFloat((magnitude(keypoints[36], keypoints[37], avgX, avgY) / width).toFixed(4));
// var r_thigh = parseFloat((magnitude(keypoints[27], keypoints[28], avgX, avgY) / width).toFixed(4));
// var l_leg = parseFloat((magnitude(keypoints[39], keypoints[40], avgX, avgY) / width).toFixed(4));
// var r_leg = parseFloat((magnitude(keypoints[30], keypoints[31], avgX, avgY) / width).toFixed(4));