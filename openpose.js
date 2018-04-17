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
            var poseData      = extractAnglesFromJson(filename);
            var magnitudeData = extractMagnitudesJSON(filename);
            var coordData     = extractRelativeCoordinatesJSON(filename);

            console.log(filename);
            //console.log(poseData);
            //console.log(magnitudeData);
            console.log(coordData);
            console.log("\n");
        });
    });

}


// Check flags
function checkFlag(argument) {
    var args = process.argv.slice(2);
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
    console.log('Openpose complete.\n');
}


/*
Takes in a path to a .JSON file that has pose data
Outputs an array with the following angles
Angle definition can be found near getAngle() declaration below
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
    var poseData = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];

    if (jsonData.people.length == 0) {
        return 0;
    }
    else {
        openposeData = JSON.parse(fs.readFileSync(filename, 'utf8')).people[0].pose_keypoints;
        var complete = true;
        var keypoints = jsonData.people[0].pose_keypoints;
        for (var i=3; i<42; i++) {
            if (keypoints[i] == 0)
                return 1;
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
        var l_shoulder =    getAngleRelativeToLine(keypoints[3],  keypoints[4],  keypoints[15], keypoints[16]);
        //1-2
        var r_shoulder =    getAngleRelativeToLine(keypoints[3],  keypoints[4],  keypoints[6],  keypoints[7]);
        //5-6
        var l_arm =         getAngleRelativeToLine(keypoints[15], keypoints[16], keypoints[18], keypoints[19]);
        //2-3
        var r_arm =         getAngleRelativeToLine(keypoints[6],  keypoints[7],  keypoints[9],  keypoints[10]);
        //6-7
        var l_farm =        getAngleRelativeToLine(keypoints[18], keypoints[19], keypoints[21], keypoints[22]);
        //3-4
        var r_farm =        getAngleRelativeToLine(keypoints[9],  keypoints[10], keypoints[12], keypoints[13]);
        //1-11
        var l_spine =       getAngleRelativeToLine(keypoints[3],  keypoints[4],  keypoints[33], keypoints[34]);
        //1-8
        var r_spine =       getAngleRelativeToLine(keypoints[3],  keypoints[4],  keypoints[24], keypoints[25]);
        //11-12
        var l_thigh =       getAngleRelativeToLine(keypoints[33], keypoints[34], keypoints[36], keypoints[37]);
        //8-9
        var r_thigh =       getAngleRelativeToLine(keypoints[24], keypoints[25], keypoints[27], keypoints[28]);
        //12-13
        var l_leg =         getAngleRelativeToLine(keypoints[36], keypoints[37], keypoints[39], keypoints[40]);
        //9-10
        var r_leg =         getAngleRelativeToLine(keypoints[27], keypoints[28], keypoints[30], keypoints[31]);

        return [l_shoulder, r_shoulder,
                l_arm, r_arm,
                l_farm, r_farm,
                l_spine, r_spine,
                l_thigh, r_thigh,
                l_leg, r_leg];
    }
}


/*
Input: array of length 12 gotten from getAngles()
output:array of length 12 with left and right limbs swapped 
*/
function flipAngles(angles) {
    var output = [angles[1], angles[0],
                  angles[3], angles[2],
                  angles[5], angles[4],
                  angles[7], angles[6],
                  angles[9], angles[8],
                  angles[11],angles[10]];
    return output;  
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
    THIS DOES NOT GUARANTEE THAT THE COORDINATES ARE VALID
*/
function getCropData(filename) {

    var jsonData = JSON.parse(fs.readFileSync(filename, 'utf8'));
    //missing pose
    if (jsonData.people.length == 0)
        return 0

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

    //padding
    if (height > width) {
        var padding = Math.round((height - width)/2);
        left  -= padding;
        right += padding;
    }
    else {
        var padding = Math.round((width - height)/2);
        upper -= padding;
        lower += padding;
    }

    return [upper,left,lower,right];
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
function getAngleRelativeToLine(x1, y1, x2, y2) {
    // Convert points to vectors
    var vectorX = x2 - x1;
    var vectorY = y2 - y1;
    var magnitude = Math.pow((Math.pow(vectorX, 2) + Math.pow(vectorY, 2)), 0.5);

    var angle = Math.round(radiansToDegrees(Math.acos(vectorY / magnitude)));

    //return (x2 > x1) ? angle : (angle >= 180 ? 360 - angle : angle);
    
    return (x2 > x1) ? angle : -angle;
}


// TODO: Documentation
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


// Converts radians to degrees
function radiansToDegrees(radians) {
    return (radians * 180 / Math.PI);
}


// Converts degrees to radians
function degreesToRadians(degrees) {
    return (degrees * Math.PI / 180);
}


/*
Input: JSON file path
Output: 0 = no pose
        1 = incomplete pose
        Array of scaled magnitudes trimmed to 5 decimal places
            Scale is magnitude / pose width
*/
function extractMagnitudesJSON(filename) {
    var jsonData = JSON.parse(fs.readFileSync(filename, 'utf8'));
    // left + right shoulders, arms, farms, spine, thighs, legs
    var poseData = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];

    if (jsonData.people.length == 0) {
        return 0;
    }
    openposeData = JSON.parse(fs.readFileSync(filename, 'utf8')).people[0].pose_keypoints;
    var keypoints = jsonData.people[0].pose_keypoints;
    for (var i=3; i<42; i++) {
        if (keypoints[i] == 0)
            return 1;
    }

    //find midpoint (average of all points)
    var avgX = 0;
    var avgY = 0;

    for(var i=1; i<=13; i++) {
        avgX += openposeData[i*3 ];
        avgY += openposeData[i*3 + 1]
    }
    avgX = avgX/13;
    avgY = avgY/13;

    //[upper,left,lower,right]
    var size   = getCropData(filename);
    // width and height should be equal
    var width  = size[3] - size[1];

    console.log("width, height in pixels " + width + ", " + height)
    
    //Trims to 5 decimal places
    var l_shoulder = parseFloat((magnitude(openposeData[15], openposeData[16], avgX, avgY) / width).toFixed(3));
    var r_shoulder = parseFloat((magnitude(openposeData[6],  openposeData[7],  avgX, avgY) / width).toFixed(3));
    var l_arm      = parseFloat((magnitude(openposeData[18], openposeData[19], avgX, avgY) / width).toFixed(3));
    var r_arm      = parseFloat((magnitude(openposeData[9],  openposeData[10], avgX, avgY) / width).toFixed(3));
    var l_farm     = parseFloat((magnitude(openposeData[21], openposeData[22], avgX, avgY) / width).toFixed(3));
    var r_farm     = parseFloat((magnitude(openposeData[12], openposeData[13], avgX, avgY) / width).toFixed(3));
    var l_spine    = parseFloat((magnitude(openposeData[33], openposeData[34], avgX, avgY) / width).toFixed(3));
    var r_spine    = parseFloat((magnitude(openposeData[24], openposeData[25], avgX, avgY) / width).toFixed(3));
    var l_thigh    = parseFloat((magnitude(openposeData[36], openposeData[37], avgX, avgY) / width).toFixed(3));
    var r_thigh    = parseFloat((magnitude(openposeData[27], openposeData[28], avgX, avgY) / width).toFixed(3));
    var l_leg      = parseFloat((magnitude(openposeData[39], openposeData[40], avgX, avgY) / width).toFixed(3));
    var r_leg      = parseFloat((magnitude(openposeData[30], openposeData[31], avgX, avgY) / width).toFixed(3));

    poseData = [l_shoulder, r_shoulder,
                l_arm, r_arm,
                l_farm, r_farm,
                l_spine, r_spine,
                l_thigh, r_thigh,
                l_leg, r_leg];

    return poseData;

}


//Return relative coords of keypoints
//[X1, Y1, X2, Y2, ...]
function extractRelativeCoordinatesJSON(filename) {
    var jsonData = JSON.parse(fs.readFileSync(filename, 'utf8'));

    if (jsonData.people.length == 0) {
        return 0;
    }

    keypoints = JSON.parse(fs.readFileSync(filename, 'utf8')).people[0].pose_keypoints;
    var keypoints = jsonData.people[0].pose_keypoints;
    for (var i=3; i<42; i++) {
        if (keypoints[i] == 0)
            return 1;
    }

    //[upper,left,lower,right]
    var size   = getCropData(filename);
    // width and height should be equal
    var width  = size[3] - size[1];
    var output = [];
    var coordX, coordY;

    for (var i=3; i<=39; i+=3) {
        //X
        coordX = keypoints[i] - size[1];
        output.push(parseFloat((coordX/width).toFixed(3)));
        //Y
        coordY = keypoints[i+1] - size[0]
        output.push(parseFloat((coordY/width).toFixed(3)));
    }

    return output;
}


//Returns absolute distance between two (X,Y) coordinates
function magnitude(x1, y1, x2, y2) {
    return Math.abs(Math.pow((Math.pow((x2 - x1),2) + Math.pow((y2-y1), 2)), 0.5));
}


// Execute
main();

