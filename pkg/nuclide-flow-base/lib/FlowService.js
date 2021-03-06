'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {Observable} from 'rxjs';

import type {NuclideUri} from '../../nuclide-remote-uri';

// Diagnostic information, returned from findDiagnostics.
export type Diagnostics = {
  // The location of the .flowconfig where these messages came from.
  flowRoot: NuclideUri,
  messages: Array<Diagnostic>,
};

/*
 * Each error or warning can consist of any number of different messages from
 * Flow to help explain the problem and point to different locations that may be
 * of interest.
 */
export type Diagnostic = {
  level: string,
  messageComponents: Array<MessageComponent>,
};

export type MessageComponent = {
  descr: string,
  range: ?Range,
};

export type Range = {
  file: NuclideUri,
  start: Point,
  end: Point,
};

export type Point = {
  line: number,
  column: number,
};

export type Loc = {
  file: NuclideUri,
  point: Point,
};

// If types are added here, make sure to also add them to FlowConstants.js. This needs to be the
// canonical type definition so that we can use these in the service framework.
export type ServerStatusType =
  'failed' |
  'unknown' |
  'not running' |
  'not installed' |
  'busy' |
  'init' |
  'ready';

export type ServerStatusUpdate = {
  pathToRoot: NuclideUri,
  status: ServerStatusType,
};

export type FlowOutlineTree = {
  tokenizedText: TokenizedText,
  representativeName?: string,
  children: Array<FlowOutlineTree>,
  startPosition: Point,
  endPosition: Point,
};

// The origin of this type is at nuclide-tokenized-text/lib/main.js
// When updating update both locations!
export type TokenKind = 'keyword'
  | 'class-name'
  | 'constructor'
  | 'method'
  | 'param'
  | 'string'
  | 'whitespace'
  | 'plain'
  | 'type'
  ;

// The origin of this type is at nuclide-tokenized-text/lib/main.js
// When updating update both locations!
export type TextToken = {
  kind: TokenKind,
  value: string,
};

// The origin of this type is at nuclide-tokenized-text/lib/main.js
// When updating update both locations!
export type TokenizedText = Array<TextToken>;

export type FlowCoverageResult = {
  percentage: number,
  uncoveredRanges: Array<{
    start: Point,
    end: Point,
  }>,
};

import {FlowRoot} from './FlowRoot';
import {FlowServiceState} from './FlowServiceState';

let state: ?FlowServiceState = null;

function getState(): FlowServiceState {
  if (state == null) {
    state = new FlowServiceState();
  }
  return state;
}

export function dispose(): void {
  if (state != null) {
    state.dispose();
    state = null;
  }
}

export function getServerStatusUpdates(): Observable<ServerStatusUpdate> {
  return getState().getRootContainer().getServerStatusUpdates();
}

export function flowFindDefinition(
  file: NuclideUri,
  currentContents: string,
  line: number,
  column: number,
): Promise<?Loc> {
  return getState().getRootContainer().runWithRoot(
    file,
    root => root.flowFindDefinition(
      file,
      currentContents,
      line,
      column,
    ),
  );
}

export function flowFindDiagnostics(
  file: NuclideUri,
  currentContents: ?string,
): Promise<?Diagnostics> {
  return getState().getRootContainer().runWithRoot(
    file,
    root => root.flowFindDiagnostics(
      file,
      currentContents,
    ),
  );
}

export function flowGetAutocompleteSuggestions(
  file: NuclideUri,
  currentContents: string,
  line: number,
  column: number,
  prefix: string,
  activatedManually: boolean,
): Promise<any> {
  return getState().getRootContainer().runWithRoot(
    file,
    root => root.flowGetAutocompleteSuggestions(
      file,
      currentContents,
      line,
      column,
      prefix,
      activatedManually,
    ),
  );
}

export async function flowGetType(
  file: NuclideUri,
  currentContents: string,
  line: number,
  column: number,
  includeRawType: boolean,
): Promise<?{type: string, rawType: ?string}> {
  return getState().getRootContainer().runWithRoot(
    file,
    root => root.flowGetType(
      file,
      currentContents,
      line,
      column,
      includeRawType,
    ),
  );
}

export async function flowGetCoverage(
  file: NuclideUri,
): Promise<?FlowCoverageResult> {
  return getState().getRootContainer().runWithRoot(
    file,
    root => root.flowGetCoverage(file),
  );
}

export function flowGetOutline(
  currentContents: string,
): Promise<?Array<FlowOutlineTree>> {
  return FlowRoot.flowGetOutline(currentContents);
}

export function allowServerRestart(): void {
  for (const root of getState().getRootContainer().getAllRoots()) {
    root.allowServerRestart();
  }
}
