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

const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const args = process.argv;
const folderMimeType = 'application/vnd.google-apps.folder';


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
  var oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUrl);

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

  fs.writeFile(TOKEN_PATH, JSON.stringify(token), function (err) {
    if (err) return console.log(err);
    console.log('Token stored to: ' + TOKEN_PATH);
  });
}

function isFolder(fileInfo) {

  return (fileInfo.mimeType === folderMimeType);
}
/**
 * Walk in folder
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listFiles(auth, parentId, recursive, callback) {

  var drive = google.drive({ version: 'v3', auth: auth });
  var visitedDirs = [];
  var fileList = [];

  var _listFiles = (parentId, token) => {

    var params = {
      spaces: 'drive',
      q: '\''+ parentId + '\' in parents and trashed=false',
      pageSize: 1000,
      pageToken: token,
      fields: 'nextPageToken, files(id, name, mimeType, parents)'
    };

    visitedDirs.push(parentId);
    drive.files.list(params, (err, response) => {
      if (err) {
        console.log('The API returned an error: ' + err);
        return process.exit();
      }

      var files = response.data.files;
      var nextPageToken = response.data.nextPageToken;

      if (files.length > 0) {
        for (var i = 0; i < files.length; i++) {
          var file = files[i];
          fileList.push(file);

          if (nextPageToken) {
            _listFiles(parentId, nextPageToken);
          }

          if (recursive && isFolder(file)) {
            _listFiles(file.id, null);
          }
        }
      }

      visitedDirs.pop();
      if (callback && visitedDirs.length == 0) {
        callback(parentId, fileList);
      }
    });
  };

  _listFiles(parentId, null);
}

function findFolderByName(auth, name, callback) {

  var service = google.drive('v3');
  var params = {
    auth: auth,
    q: 'name=\''+name+'\' and trashed=false and mimeType=\'application/vnd.google-apps.folder\'',
    spaces: 'drive',
    fields: '*'
  };
  //check for alias
  if(name === 'root') {
    callback({id:name});
    return;
  }

  service.files.list(params, function(err, response) {

    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    }

    var files = response.data.files;
    if (files.length == 0) {
      console.log('Drive folder \'%s\' not found.', name);
    } else {
      callback(files[0]);
    }
  });
}

/**
 * G Suite formats and supported export MIME types map 
 * https://developers.google.com/drive/v3/web/manage-downloads
 * https://developers.google.com/drive/api/v3/ref-export-formats
 */
function findDriveDocumentMimeType(fileExt)
{ 
  switch(fileExt.toLowerCase())
  {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    default:
      return null;
  }
}

function fileDownload(auth, fileInfo, filePath) {

  var drive = google.drive({ version: 'v3', auth: auth });
  var fileExt = filePath.split('.').pop();
  var mimeType = findDriveDocumentMimeType(fileExt);
 
  if(fs.existsSync(filePath)) {
    console.log('Local file %s exists', filePath);
    process.exit();
  }

  var progress = 0;
  var dest = fs.createWriteStream(filePath); 
  console.log('Downloading %s...', filePath);

  var progressCallaback = (data) => {
    progress += data.length;        
    if (process.stdout.isTTY) {
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
      process.stdout.write(`Downloaded ${progress} bytes`);
    } 
  };

  if (mimeType) {
    drive.files.export(
      { fileId: fileInfo.id, mimeType : mimeType },
      { responseType: 'stream' }
    ).then(res => {
      res.data
        .on('end', () => {
          console.log('');
        })  
        .on('error', err => {
          console.error('Error downloading file.');
        })  
        .on('data', progressCallaback)  
        .pipe(dest);
    });
  } else {  
    drive.files.get(
      { fileId: fileInfo.id, alt: 'media' },
      { responseType: 'stream' }
    ).then(res => {
    res.data
      .on('end', () => {
        console.log('');
      })  
      .on('error', err => {
        console.error('Error downloading file.');
      })  
      .on('data', progressCallaback)  
      .pipe(dest);
    });
  }

  dest.on('finish', function () {
    console.log('Downloaded %s', filePath);
  }).on('error', function (err) {
    console.log('Error writing file', err);
    process.exit();
  });
}

function fileUpload(auth, filePath, fileInfo, parentId, callback) {

  var name = path.basename(filePath);
  if(!name || !fs.existsSync(filePath)) {
    console.log('Invalid file', filePath);
    process.exit();
  }

  var drive = google.drive({ version: 'v3', auth: auth });
  console.log('Uploading %s ...', name);

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
  fileInfo.parentsPath = path.reverse().join('/');
}

function getFolderContent(auth, options, callback) {

  findFolderByName(auth, options.folder, function(folderInfo) {
    console.log('gdrive folder \'%s\' (%s)', options.folder, folderInfo.id);
    listFiles(auth, folderInfo.id, options.recursive, callback);
  });
}

function createFolder(auth, path, parent, callback)
{
  var drive = google.drive({ version: 'v3', auth: auth });
  var parents = [parent];
  var fileMetadata = {
    'name': path,
    'parents': parents,
    'mimeType': folderMimeType
  };
  
  drive.files.create({
    resource: fileMetadata,
    fields: 'id, name'
  }, callback);
}

function main(auth) {

  var options = {};
  parseArgs(options);

  if (options.help) {
    usage();
    return;
  }

  if (options.clear) {
    fs.unlinkSync(options.clear);
    return;
  }

  getFolderContent(auth, options, function(folderId, fileList) {

    const findFileInfo =  (fileName) => {
      return fileList.find(function(fileInfo) {
        return (fileInfo.name == path.basename(fileName));
      });
    }

    if (options.list) {
      fileList.forEach(function(fileInfo) {
        findParents(fileList, fileInfo);

        if (fileInfo.parentsPath) {
          fileInfo.parentsPath += '/';
        }

        console.log('drive#%s:%s/%s%s', isFolder(fileInfo) ? 'folder': 'file', 
                    options.folder, fileInfo.parentsPath, fileInfo.name);
      });
      return;
    }

    if (options.upload) {
      var fileInfo = findFileInfo(options.upload);
      fileUpload(auth, options.upload, fileInfo, folderId, function(err, fileInfo) {
        if (err) {
          console.log('The API returned an error:', err);
          return;
        }
        console.log('File %s uploaded on drive', fileInfo.data.name);
      });
      return;
    }

    if (options.download) {
      var fileInfo = findFileInfo(options.download);
      if (fileInfo) {
        fileDownload(auth, fileInfo, options.download);
      } else {
        console.log('File %s not found on drive', options.download);
      }
    }

    if (options.delete){
      var fileInfo = findFileInfo(options.delete);
      if (fileInfo) {
        fileDelete(auth, fileInfo, function(err, fileInfo) {
          if (err) {
            console.log('The API returned an error:', err);
            return;
          }
          console.log('File %s deleted on drive', options.delete);
        });
      } else {
        console.log('File %s not found on drive', options.delete);
      }
    }

    if (options.mkdir)
    {
      if (!fileInfo) {
        createFolder(auth, options.mkdir, folderId, function (err, file) {
        if (err) {
          console.error(err);
          return;
        }
        console.log('Folder %s created on drive', file.data.name);
      });
      } else {
        console.log('Folder %s already exists on drive', options.mkdir);
      }
    }
  });
}

function usage() {
  console.log('Usage: node %s\n'
    +'-f <folder>   selct gdrive parent folder if not set defaults to root\n'
    +'-g <filePath> get file from drive\n'
    +'-p <filePath> put file on drive\n'
    +'-d <filePath> del file from drive\n'
    +'-m <folder>   create folde on drive\n'
    +'-l            list files from selected folder\n'
    +'-r            recursive (can exceeded your user rate limit)\n'
    +'-c            delete stored credentials\n'
    +'\n', args[1]);
}

function parseArgs(options) {
  options.folder = 'root';

  if (args.length === 2) {
    options.help = true;
    return;
  }

  var nextArg = (argIndex) => {
    if (argIndex >= args.length || !args[argIndex]) {
      console.log("Invalid or missing argument");
      process.exit();
    } 
    return args[argIndex];
  };

  var opts = [
    { switch: "-f", command: 'folder', nextarg: true },
    { switch: '-g', command: 'download', nextarg: true},
    { switch: '-p', command: 'upload', nextarg: true },
    { switch: '-d', command: 'delete', nextarg: true, },
    { switch: '-l', command: 'list', nextarg: false, value: true },
    { switch: '-c', command: 'clear', nextarg: false, value: TOKEN_PATH },
    { switch: '-r', command: 'recursive', nextarg: false, value: true },
    { switch: '-m', command: 'mkdir', nextarg: true}
  ];

  for (var i = 2; i < args.length; i++) {
    var arg = args[i];
    const foundOpt = opts.find(element => element.switch.indexOf(arg) > -1);
    if (foundOpt) {
      let value = (foundOpt.nextarg === true) ? nextArg(++i) : foundOpt.value; 
      if (!value) {
        throw 'Undefined option value';
      }
      options[foundOpt.command] = value;
    } else {
      options.help = true;
      return;
    }
  }
}