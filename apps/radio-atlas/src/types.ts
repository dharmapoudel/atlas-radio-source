// Radio Atlas types - ported from Omarchy plugin's RadioModel.js
// Original: https://github.com/AksharP5/omarchy-radio-atlas

export interface Station {
  uuid: string;
  name: string;
  url: string;
  homepage: string;
  favicon: string;
  country: string;
  countryCode: string;
  state: string;
  language: string;
  tags: string;
  codec: string;
  bitrate: number;
  votes: number;
  clicks: number;
  latitude: number | null;
  longitude: number | null;
}

export type TabMode = 'world' | 'map' | 'search' | 'country' | 'favorites' | 'recent';

// the tab bar order; also the allow-list for the persisted last-open tab
export const TABS: TabMode[] = ['map', 'world', 'country', 'favorites', 'recent'];
