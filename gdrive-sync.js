#! /usr/bin/env node
/**
 * google drive utility
 *
 * Copyright (C) 2017 Borislav Sapundzhiev
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or (at
 * your option) any later version.
 *
 */
'use strict';

var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var path = require('path');

const args = process.argv;
const folderMimeType = "application/vnd.google-apps.folder";

// If modifying these scopes, delete your previously saved credentials
// at ~/.credentials/drive-nodejs-quickstart.json
var SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly'
];
var HOME_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE);
var TOKEN_DIR = HOME_DIR + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'drive-nodejs-quickstart.json';

// Load client secrets from a local file.
fs.readFile(HOME_DIR+"/"+'client_secret.json', function processClientSecrets(err, content) {
  if (err) {
    console.log('Error loading client secret file: ' + err);
    return;
  }
  // Authorize a client with the loaded credentials, then call the
  // Drive API.
  authorize(JSON.parse(content), main);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  var clientSecret = credentials.installed.client_secret;
  var clientId = credentials.installed.client_id;
  var redirectUrl = credentials.installed.redirect_uris[0];
  var auth = new googleAuth();
  var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client);
    }
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ', authUrl);
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Enter the code from that page here: ', function(code) {
    rl.close();
    oauth2Client.getToken(code, function(err, token) {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  console.log('Token stored to ' + TOKEN_PATH);
}

function isFolder(fileInfo) {

  return (fileInfo.mimeType === folderMimeType);
}
/**
 * Walk in folder
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listFiles(auth, parent_id, pageToken, callback, recursive) {
  var ref = 0;
  var fileList = [];
  var prevToken = null;

  var _listFiles = (auth, parent_id, token) => {
    ref++;
    var service = google.drive('v3');
    var params = {
      auth: auth,
      spaces: 'drive',
      q:  "'"+ parent_id + "' in parents and trashed=false",
      pageSize: 100,
      pageToken: pageToken,
      fields: "*"
    };

    service.files.list(params, function(err, response) {
      if (err) {
        console.log('The API returned an error: ' + err);
        return process.exit();
      }

      var files = response.files;
      if (files.length == 0) {
        console.log('No files found.');
      } else {

        for (var i = 0; i < files.length; i++) {
          var file = files[i];
          //console.log('%s (%s) mime %s', file.name, file.id, file.mimeType);
          fileList.push(file);

          if (recursive && isFolder(file)) {
            _listFiles(auth, file.id, null);
          }
        }

        if(prevToken != response.nextPageToken) {
          _listFiles(auth, parent_id, response.nextPageToken);
        }
        prevToken = response.nextPageToken;
      }

      ref--;
      if(ref == 0) { callback(parent_id, fileList); }
    });
  }

  _listFiles(auth, parent_id, pageToken);
}


function findFolderByName(auth, name, callback) {

  var service = google.drive('v3');
  var params = {
    auth: auth,
    q: "name='"+name+"' and trashed=false and mimeType='application/vnd.google-apps.folder'",
    spaces: 'drive',
    fields: "*"
  };
  //check for alias
  if(name === "root") {
    callback({id:name});
    return;
  }

  service.files.list(params, function(err, response) {

    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    }

    var files = response.files;
    if (files.length == 0) {
      console.log('Drive folder \'%s\' not found.', name);
    } else {
      callback(files[0]);
    }
  });
}

function fileDownload(auth, fileInfo, filePath) {

  var drive = google.drive({ version: 'v3', auth: auth });
  var ext = filePath.split('.').pop();
  var mimeType = null;
  //https://developers.google.com/drive/v3/web/manage-downloads
  if(ext === "docx") {
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  console.log('Downloading %s...', filePath);

  var dest = fs.createWriteStream(filePath);

  if (mimeType) {
    drive.files.export({
      fileId: fileInfo.id,
      mimeType : mimeType
    }).on('error', function (err) {
      console.log('Error downloading file', err);
      process.exit();
    }).pipe(dest);

  } else {
    drive.files.get({
      fileId: fileInfo.id,
      alt: 'media'
    }).on('error', function (err) {
      console.log('Error downloading file', err);
      process.exit();
    }).pipe(dest);
  }

  dest.on('finish', function () {
    console.log('Downloaded %s!', filePath);
  }).on('error', function (err) {
    console.log('Error writing file', err);
    process.exit();
  });
}

function fileUpload(auth, filePath, fileInfo, parentId, callback) {

  var name = path.basename(filePath);
  if(!name) {
    console.log('Invalid file', filePath);
    process.exit();
  }

  var drive = google.drive({ version: 'v3', auth: auth });
  console.log("Uploading %s ...", name);

  if(fileInfo) {
      drive.files.update({
      fileId: fileInfo.id,
      media: {
        body: fs.createReadStream(filePath)
      }
    }, callback);
  } else {
      drive.files.create({
      resource: {
        parents: [parentId],
        name: name
      },
      media: {
        body: fs.createReadStream(filePath)
      }
    }, callback);
  }
}

function fileDelete(auth, fileInfo, callback) {

  var drive = google.drive({ version: 'v3', auth: auth });

  drive.files.delete({
    fileId: fileInfo.id
  }, callback);
}

function findParents(fileList, fileInfo) {
  var path= [];
  var find = (fileList, fileInfo) => {
    var file = fileList.find(function(fileItem) {
      return (fileItem.id == fileInfo.parents[0]);
    });

    if (file) {
      path.push(file.name);
      find(fileList, file);
    }
  }

  find(fileList, fileInfo);
  fileInfo.parentsPath = path.reverse().join("/");
}

function getFolderContent(auth, options, callback) {

  findFolderByName(auth, options.folder, function(folderInfo) {
    console.log("gdrive folder '%s' (%s)", options.folder, folderInfo.id);
    listFiles(auth, folderInfo.id, null, callback, options.recursive);
  });
}

function main(auth) {

  var options = {};
  parseArgs(options);
  //console.log(options);

  if (options.command === "help") {
    usage();
    return;
  }

  if (options.command === "clear") {
    fs.unlinkSync(options.filePath);
    return;
  }

  getFolderContent(auth, options, function(folderId, fileList) {

    if (options.command === "list") {
      fileList.forEach(function(fileInfo) {
        findParents(fileList, fileInfo);

        if (fileInfo.parentsPath) {
          fileInfo.parentsPath += "/";
        }

        console.log("drive#%s:%s/%s%s", isFolder(fileInfo) ? "folder": "file", options.folder, fileInfo.parentsPath, fileInfo.name);
      });
      return;
    }

    var fileInfo = fileList.find(function(fileInfo) {
      return (fileInfo.name == path.basename(options.filePath));
    });

    if (options.command === "upload") {
      fileUpload(auth, options.filePath, fileInfo, folderId, function(err, fileInfo) {
        console.log("file uploaded: ", err, fileInfo);
      });
      return;
    }

    if (options.command === "download" || options.command === "del") {
      if (fileInfo) {
        if (options.command === "del") {
          fileDelete(auth, fileInfo, function(err, fileInfo) {
            console.log("file deleted: ", err, fileInfo);
          });
        } else {
          fileDownload(auth, fileInfo, options.filePath);
        }

      } else {
        console.log("File %s not found on drive", options.filePath);
      }
      return;
    }
  });
}

function usage() {
  console.log("Usage: node %s\n"
    +"-f <folder>   selct gdrive folder\n"
    +"-g <filePath> get file\n"
    +"-p <filePath> put file\n"
    +"-d <filePath> del file\n"
    +"-l            list files\n"
    +"-r            recursive (can exceeded your user rate limit)\n"
    +"-c            delete stored credentials\n"
    +"\n", args[1]);
}

function parseArgs(options) {
  options.folder = "root";
  options.command = "help";

  if (args.length === 2) {
    return;
  }

  for (var i = 2; i < args.length; i++) {

    switch(args[i]) {
      case "-f":
        options.folder = args[++i];
        break;
      case "-g":
        options.command = "download";
        options.filePath = args[++i];
        break;
      case "-p":
        options.command = "upload";
        options.filePath = args[++i];
        break;
      case "-d":
        options.command = "del";
        options.filePath = args[++i];
        break;
      case "-l":
        options.command = "list";
        break;
      case "-c":
        options.command= "clear";
        options.filePath = TOKEN_PATH;
        break;
      case "-r":
        options.recursive = true;
        break;
      default: {
        options.command ="help";
        return;
      }
    }
  }
}
