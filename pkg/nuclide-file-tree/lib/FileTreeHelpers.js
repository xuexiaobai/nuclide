'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {NuclideUri} from '../../nuclide-remote-uri';
import type {RemoteDirectory, RemoteFile} from '../../nuclide-remote-connection';

import {Directory as LocalDirectory} from 'atom';
import {File as LocalFile} from 'atom';
import {
  RemoteConnection,
  ServerConnection,
} from '../../nuclide-remote-connection';
import nuclideUri from '../../nuclide-remote-uri';

import crypto from 'crypto';

export type Directory = LocalDirectory | RemoteDirectory;
type File = LocalFile | RemoteFile;
type Entry = LocalDirectory | RemoteDirectory | LocalFile | RemoteFile;

function dirPathToKey(path: string): string {
  return nuclideUri.ensureTrailingSeparator(nuclideUri.trimTrailingSeparator(path));
}

function isDirKey(key: string): boolean {
  return nuclideUri.endsWithSeparator(key);
}

function keyToName(key: string): string {
  return nuclideUri.basename(key);
}

function keyToPath(key: string): string {
  return nuclideUri.trimTrailingSeparator(key);
}

function getParentKey(key: string): string {
  return nuclideUri.ensureTrailingSeparator(nuclideUri.dirname(key));
}

// The array this resolves to contains the `nodeKey` of each child
function fetchChildren(nodeKey: string): Promise<Array<string>> {
  const directory = getDirectoryByKey(nodeKey);

  return new Promise((resolve, reject) => {
    if (directory == null) {
      reject(`Directory "${nodeKey}" not found or is inaccessible.`);
      return;
    }

    // $FlowIssue https://github.com/facebook/flow/issues/582
    directory.getEntries((error, entries) => {
      // Resolve to an empty array if the directory deson't exist.
      // TODO: should we reject promise?
      if (error && error.code !== 'ENOENT') {
        reject(error);
        return;
      }
      entries = entries || [];
      const keys = entries.map(entry => {
        const path = entry.getPath();
        return entry.isDirectory() ? dirPathToKey(path) : path;
      });
      resolve(keys);
    });
  });
}

function getDirectoryByKey(key: string): ?Directory {
  const path = keyToPath(key);
  if (!isDirKey(key)) {
    return null;
  } else if (nuclideUri.isRemote(path)) {
    const connection = ServerConnection.getForUri(path);
    if (connection == null) {
      return null;
    }
    return connection.createDirectory(path);
  } else {
    return new LocalDirectory(path);
  }
}

function getFileByKey(key: string): ?File {
  const path = keyToPath(key);
  if (isDirKey(key)) {
    return null;
  } else if (nuclideUri.isRemote(path)) {
    const connection = ServerConnection.getForUri(path);
    if (connection == null) {
      return null;
    }
    return connection.createFile(path);
  } else {
    return new LocalFile(path);
  }
}

function getEntryByKey(key: string): ?Entry {
  return getFileByKey(key) || getDirectoryByKey(key);
}

function getDisplayTitle(key: string): ?string {
  const path = keyToPath(key);

  if (nuclideUri.isRemote(path)) {
    const connection = RemoteConnection.getForUri(path);

    if (connection != null) {
      return connection.getDisplayTitle();
    }
  }
}

// Sometimes remote directories are instantiated as local directories but with invalid paths.
function isValidDirectory(directory: Directory): boolean {
  if (!isLocalEntry((directory: any))) {
    return true;
  }

  const dirPath = directory.getPath();
  return nuclideUri.isAbsolute(dirPath);
}

function isLocalEntry(entry: Entry): boolean {
  // TODO: implement `RemoteDirectory.isRemoteDirectory()`
  return !('getLocalPath' in entry);
}

function isContextClick(event: SyntheticMouseEvent): boolean {
  return (
    event.button === 2 ||
    (event.button === 0 && event.ctrlKey === true && process.platform === 'darwin')
  );
}

function buildHashKey(nodeKey: string): string {
  return crypto.createHash('MD5').update(nodeKey).digest('base64');
}

function updatePathInOpenedEditors(oldPath: NuclideUri, newPath: NuclideUri): void {
  atom.workspace.getTextEditors().forEach(editor => {
    const buffer = editor.getBuffer();
    if (buffer.getPath() === oldPath) {
      // setPath will append the hostname when given the local path, so we
      // strip off the hostname here to avoid including it twice in the path.
      buffer.setPath(nuclideUri.getPath(newPath));
    }
  });
}

module.exports = {
  dirPathToKey,
  isDirKey,
  keyToName,
  keyToPath,
  getParentKey,
  fetchChildren,
  getDirectoryByKey,
  getEntryByKey,
  getFileByKey,
  getDisplayTitle,
  isValidDirectory,
  isLocalEntry,
  isContextClick,
  buildHashKey,
  updatePathInOpenedEditors,
};
