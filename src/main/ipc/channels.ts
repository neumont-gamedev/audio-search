/**
 * The single source of truth for IPC channel names, shared by the handler registration in
 * the main process and the preload bridge. Keeping them in one list makes it obvious what
 * surface the renderer actually has.
 */
export const IPC = {
  selectFolder: 'dialog:selectFolder',

  listLibraries: 'library:list',
  addLibrary: 'library:add',
  removeLibrary: 'library:remove',
  rescanLibrary: 'library:rescan',
  cancelScan: 'library:cancelScan',
  openLibraryFolder: 'library:openFolder',

  search: 'index:search',
  getFacets: 'index:facets',
  getFile: 'index:getFile',

  showInFolder: 'file:showInFolder',
  copyPath: 'file:copyPath',
  copyFileToClipboard: 'file:copyToClipboard',
  copyToDestination: 'file:copyToDestination',
  getPlaybackUrl: 'file:playbackUrl',
  startDrag: 'file:startDrag',

  listDestinations: 'destination:list',
  addDestination: 'destination:add',

  setFavorite: 'user:setFavorite',
  listTags: 'user:listTags',
  addTag: 'user:addTag',
  removeTag: 'user:removeTag',
} as const;

/** Main -> renderer push events. */
export const EVENTS = {
  scanProgress: 'event:scanProgress',
  /** The library or destination lists changed and should be refetched. */
  librariesChanged: 'event:librariesChanged',
  indexChanged: 'event:indexChanged',
} as const;
