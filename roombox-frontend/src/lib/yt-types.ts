export interface SearchResult {
  album: Album;
  artists: Artist[];
  category: string;
  duration: string;
  duration_seconds: number;
  inLibrary: boolean;
  isExplicit: boolean;
  resultType: "video" | "song" | "artist" | "profile" | "playlist" | "album";
  thumbnails: Thumbnail[];
  title: string;
  videoId: string;
  videoType: string;
  views: string;
  year: number;
}

export interface Album {
  id: string;
  name: string;
}

export interface Artist {
  id: string;
  name: string;
}

export interface Thumbnail {
  height: number;
  url: string;
  width: number;
}
