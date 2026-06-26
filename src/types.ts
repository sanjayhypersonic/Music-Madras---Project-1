export interface Video {
  id: string;
  youtubeId: string;
  title: string;
  artist: string;
  category: 'Organ' | 'Choral' | 'Vocal' | 'Instrumental' | 'Concert';
  duration: string;
  views: string;
  publishedAt: string;
  description: string;
  likesCount: number;
  thumbnailUrl: string;
}

export interface Playlist {
  id: string;
  title: string;
  videoCount: number;
  description: string;
  youtubeUrl: string;
  imageQuery: string;
  thumbnailUrl: string;
}

export interface BookingRequest {
  id: string;
  artistName: string;
  email: string;
  phone: string;
  instrument: string;
  eventType: 'Concert' | 'Arangetram' | 'Recital' | 'Studio' | 'Other';
  eventDate: string;
  eventLocation: string;
  packageType: 'Free Collaboration' | 'Premium Private';
  soundSampleUrl?: string;
  message?: string;
  status: 'Pending' | 'Approved' | 'Contacted';
  createdAt: string;
}

export interface CommunityPost {
  id: string;
  date: string;
  content: string;
  likes: number;
  comments: number;
}
