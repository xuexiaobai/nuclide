'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import {CompositeDisposable} from 'atom';

const DEFER_SCROLL_SYNC_MS = 10;

export default class SyncScroll {

  _subscriptions: CompositeDisposable;
  _syncInfo: Array<{
    scrollElement: atom$TextEditorElement,
    scrolling: boolean,
  }>;
  _scrollSyncTimeout: ?number;

  constructor(editor1Element: atom$TextEditorElement, editor2Element: atom$TextEditorElement) {
    // Atom master or >= v1.0.18 have changed the scroll logic to the editor element.
    this._subscriptions = new CompositeDisposable();
    this._syncInfo = [{
      scrollElement: editor1Element,
      scrolling: false,
    }, {
      scrollElement: editor2Element,
      scrolling: false,
    }];
    this._syncInfo.forEach((editorInfo, i) => {
      // Note that `onDidChangeScrollTop` isn't technically in the public API.
      const {scrollElement} = editorInfo;
      const updateScrollPosition = () => this._scrollPositionChanged(i);
      this._subscriptions.add(scrollElement.onDidChangeScrollTop(updateScrollPosition));
      this._subscriptions.add(scrollElement.onDidChangeScrollLeft(updateScrollPosition));
    });
    this._scrollSyncTimeout = null;
    this._scrollPositionChanged(1);
  }

  _scrollPositionChanged(changeScrollIndex: number): void {
    const thisInfo = this._syncInfo[changeScrollIndex];
    if (thisInfo.scrolling) {
      return;
    }
    const otherInfo = this._syncInfo[1 - changeScrollIndex];
    const {scrollElement: otherElement} = otherInfo;
    if (otherElement.component == null) {
      // The other editor isn't yet attached,
      // while both editors were already in sync when attached.
      return;
    }
    const {scrollElement: thisElement} = thisInfo;
    if (thisElement.getScrollHeight() !== otherElement.getScrollHeight()) {
      // One of the editors' dimensions is pending sync.
      if (this._scrollSyncTimeout != null) {
        clearTimeout(this._scrollSyncTimeout);
      }
      this._scrollSyncTimeout = setTimeout(() => {
        this._scrollPositionChanged(1);
        this._scrollSyncTimeout = null;
      }, DEFER_SCROLL_SYNC_MS);
      return;
    }
    otherInfo.scrolling = true;
    otherElement.setScrollTop(thisElement.getScrollTop());
    otherElement.setScrollLeft(thisElement.getScrollLeft());
    otherInfo.scrolling = false;
  }

  dispose(): void {
    this._subscriptions.dispose();
    if (this._scrollSyncTimeout != null) {
      clearTimeout(this._scrollSyncTimeout);
    }
  }
}
