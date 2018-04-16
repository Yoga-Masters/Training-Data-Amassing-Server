var fs = require('fs');
var gm = require('gm');
var path = require('path');

/*
Arguments
"node openpose.js [arguments]"

-write_images : Decides to write images with keypoint data on it.

Input : Image(s) in directory same level with openpose.js named input
Output: If -write_images is on, will write an image with keypoints labeled on it in output directory
        Also writes JSON file with keypoints in it in output directory.
*/
function main() {
    console.log(getAngleVectors({x:401, y:431}, {x:388,y:596}));
    //console.log(getAngle(401, 431, 388, 596));


    //process.exit(1);

    //Runs openpose on a whole directory
    runOpenPose("./input/", "./output/");
    //Loops over every image in directory
    fs.readdir('./input/', 'utf-8', function(err, files) {
        if (err) {
            console.log('Error: Directory not found.');
            process.exit(1);
        }

        files.forEach(function(file, index) {
            //calculate angle
            var filename = './output/' + file.slice(0, -4) + '_keypoints.json';
            var poseData;
            var openposeData;
            var poseData = extractAnglesFromJson(filename);

            console.log(filename);
            console.log(poseData);
            console.log();

            // START ANGLE EXTRACTION
            /* 
            var jsonData = JSON.parse(fs.readFileSync(filename, 'utf8'));

            if (jsonData.people.length == 0) {
                console.log("No pose detected")
                poseData = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,-1];

                console.log("Pose data for: " + file);
                console.log(poseData);
                console.log();
            }
            else {
                openposeData = JSON.parse(fs.readFileSync(filename, 'utf8')).people[0].pose_keypoints;
                var complete = true;
                var keypoints = jsonData.people[0].pose_keypoints;
                for (var i=0; i<42; i++) {
                    if (keypoints[i] == 0)
                        complete = false;
                }
                if (!complete) {
                    console.log("Incomplete pose!")
                }
                openposeData = JSON.parse(fs.readFileSync(filename, 'utf8')).people[0].pose_keypoints;
                poseData = extractAngles(filename);


                console.log("Pose data for: " + file);
                console.log(poseData);

                //console.log(openposeData);

                //crop

                //find which is longer, vertical or horizontal
                //pad the shorter size until image is square

                //console.log(file.slice(0, -4) + '_cropped.jpg saved.');
                //resize
                //console.log(file.slice(0, -4) + '_resized.jpg saved.');
                //grayscale
                //console.log(file.slice(0, -4) + '_grayscale.jpg saved.');
                
            }
            */
        });
    });
}

// Check flags
function checkFlag(argument) {
    var args =process.argv.slice(2);
    return (args.indexOf(argument) > -1);
}

/*
Main command:./OpenPoseDemo.exe
Arguments:  --image_dir [DIRECTORY]
            --write_images [DIRECTORY]
            --write_keypoint_json [DIRECTORY]
            --no_display
*/
function runOpenPose(inputDir, outputDir) {
    console.log("Running OpenPose on " + inputDir)
    if (checkFlag("-write_images")) {
        console.log("write_images true");
        'use strict';
        const
            { spawnSync } = require( 'child_process' ),
            ls = spawnSync( './openPoseDemo.exe', [ '--image_dir', inputDir,
                                                    '--write_keypoint_json', outputDir,
                                                    '--write_images', outputDir,
                                                    '--no_display'
                                                    ]);
    }
    else {
        'use strict';
        const
            { spawnSync } = require( 'child_process' ),
            ls = spawnSync( './openPoseDemo.exe', [ '--image_dir', inputDir,
                                                    '--write_keypoint_json', outputDir,
                                                    '--no_display'
                                                    ]);
    }
    console.log('Openpose complete.');
}


/*
Takes in a path to a .JSON file that has pose data
Outputs an array with the following angles
Angle definition can be found near getAngle() declaration below
    neck
    l_shoulder
    r_shoulder
    l_arm
    r_arm
    l_farm
    r_farm
    l_spine
    r_spine
    1_thigh
    r_thigh
    l_leg
    r_leg
*/

/*
Returns an array of angles if "pose" is valid
A pose is valid if:
    At least one "person" was detected in the image
    That "person" contains keypoints 0 - 13
Else return
    0: no pose detected
    1: pose detected, but it's incomplete
    Array of angles
*/
function extractAnglesFromJson(filename) {
    // JSON contents
    var jsonData = JSON.parse(fs.readFileSync(filename, 'utf8'));
    var poseData = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,-1];

    if (jsonData.people.length == 0) {
        //console.log("No pose detected");
        //console.log("Pose data for: " + filename);
        //console.log(poseData);
        //console.log();
        return 0;
    }
    else {
        openposeData = JSON.parse(fs.readFileSync(filename, 'utf8')).people[0].pose_keypoints;
        var complete = true;
        var keypoints = jsonData.people[0].pose_keypoints;
        for (var i=3; i<42; i++) {
            if (keypoints[i] == 0)
                complete = false;
        }
        openposeData = JSON.parse(fs.readFileSync(filename, 'utf8')).people[0].pose_keypoints;
        //poseData = extractAngles(filename);

        /*
        Reference for reading keypoint array
        https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/doc/media/keypoints_pose.png
        X = x coord
        Y = y coord
        C = confidence

        #  X  Y  C
        0  0  1  2
        1  3  4  5
        2  6  7  8
        3  9  10 11
        4  12 13 14
        5  15 16 17
        6  18 19 20
        7  21 22 23
        8  24 25 26
        9  27 28 29
        10 30 31 32
        11 33 34 35
        12 36 37 38
        13 39 40 41
        ...
        */

        //1-0
        //var neck =          getAngle(keypoints[3],  keypoints[4],  keypoints[0],  keypoints[1]);
        //1-5
        var l_shoulder =    getAngle(keypoints[3],  keypoints[4],  keypoints[15], keypoints[16]);
        //1-2
        var r_shoulder =    getAngle(keypoints[3],  keypoints[4],  keypoints[6],  keypoints[7]);
        //5-6
        var l_arm =         getAngle(keypoints[15], keypoints[16], keypoints[18], keypoints[19]);
        //2-3
        var r_arm =         getAngle(keypoints[6],  keypoints[7],  keypoints[9],  keypoints[10]);
        //6-7
        var l_farm =        getAngle(keypoints[18], keypoints[19], keypoints[21], keypoints[22]);
        //3-4
        var r_farm =        getAngle(keypoints[9],  keypoints[10], keypoints[12], keypoints[13]);
        //1-11
        var l_spine =       getAngle(keypoints[3],  keypoints[4],  keypoints[33], keypoints[34]);
        //1-8
        var r_spine =       getAngle(keypoints[3],  keypoints[4],  keypoints[24], keypoints[25]);
        //11-12
        var l_thigh =       getAngle(keypoints[33], keypoints[34], keypoints[36], keypoints[37]);
        //8-9
        var r_thigh =       getAngle(keypoints[24], keypoints[25], keypoints[27], keypoints[28]);
        //12-13
        var l_leg =         getAngle(keypoints[36], keypoints[37], keypoints[39], keypoints[40]);
        //9-10
        var r_leg =         getAngle(keypoints[27], keypoints[28], keypoints[30], keypoints[31]);

        var output = [l_shoulder,
                      r_shoulder,
                      l_arm,
                      r_arm,
                      l_farm,
                      r_farm,
                      l_spine,
                      r_spine,
                      l_thigh,
                      r_thigh,
                      l_leg,
                      r_leg];

        if (!complete) {
            //console.log("Incomplete pose!");
            return 1;
        }

        //console.log("Pose data for: " + filename);
        //console.log(poseData);

        return output;
    }
}

/*
Input: array of length 13 gotten from getAngles()
output:array of length 13 with legs, thighs, arms, spine, 
*/
function flipAngles(angles) {
    
}



/*
Finds cropping dimensions for pose image.
Inputs a filename for an openpose .JSON file.
Returns array of [Upper left X coord, 
                  Upper left Y coord, 
                  Lower right X coord.
                  Lower right Y coord]
If no pose is found, return -1

Note:
    Does not guarantee that the coords are within original image dimensions.
    Pads so the crop dimensions are square.

*/
function getCropData(filename) {

    var jsonData = JSON.parse(fs.readFileSync(filename, 'utf8'));
    //missing pose
    if (jsonData.people.length == 0)
        return -1

    //get coords
    var upper  = Infinity;
    var lower = 0;
    var left   = Infinity;
    var right  = 0;

    for (var i=0; i < openposeData.length; i++) {
        value = openposeData[i];
        if ((i+3) % 3 === 0) {
            if (value < left & value != 0)
                left = value;
            if (value > right & value != 0)
                right = value;
        }
        if ((i+3) % 3 === 1) {
            if (value < upper & value != 0)
                upper = value;
            if (value > lower & value != 0)
                lower = value;
        }
    }

    upper = Math.round(upper);
    lower = Math.round(lower);
    left  = Math.round(left);
    right = Math.round( right);

    height = lower - upper;
    width = right - left;

    // console.log(upper);
    // console.log(lower);
    // console.log(left);
    // console.log(right);

    return [upper,left,lower,right];
}

/*
Returns an angle between two points relative to a straight line going up.
Angle is determined as the following:

Degree  Shape (points 1 and 2)
-------------
//TODO WRITE DOC
-------------
*/
// function getAngle(x1, y1, x2, y2) {
//     // Convert lines to vectors
//     var vectorX = x2 - x1;
//     var vectorY = y2 - y1;
//     var magnitude = Math.pow((Math.pow(vectorX, 2) + Math.pow(vectorY, 2)), 0.5);

//     //var angle = radiansToDegrees(Math.acos(vectorY / magnitude));

//     return (x2 >= x1) ? Math.round(angle) : (angle >= 180 ? 360 - angle : angle);

//     // if (x2 >= x1)
//     //     return Math.round(angle);
//     // return angle >= 180 ? 360 - angle : angle
// }

// function getAngle(x1, y1, x2, y2) {
//     return getAngleVectors({x:x1, y:y1}, {x:x2,y:y2});
//     // var angle = getAngleVectors({x:x1, y:y1}, {x:x2,y:y2});
//     // return angle % 180;
// }

function getAngle(x1, y1, x2, y2) {
    // return getAngleVectors({ x: x1, y: y1 }, { x: x2, y: y2 });
    var angle = getAngleVectors({ x: x1, y: y1 }, { x: x2, y: y2 });
    return angle % 180 < 0 ? angle % 180 + 180 : angle % 180;
}

function getAngleVectors(vectorA, vectorB) {
    return Math.round(Math.atan2(vectorB.y - vectorA.y, vectorB.x - vectorA.x) * 180 / Math.PI);
}


// Alternate function to get angles.
// The angle between limbs like the inside of your arm
function getAngleAlt(x1, y1, x2, y2, x3, y3) {
    var vectorX = 0;
    var vectorY = 0;


}

function radiansToDegrees(radians) {
    return (radians * 180 / Math.PI);
}

function degreesToRadians(degrees) {
    return (degrees * Math.PI / 180);
}


// Execute
main();

