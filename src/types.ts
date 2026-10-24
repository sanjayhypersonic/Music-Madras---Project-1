export interface Video {
  id: string;
  youtubeId: string;
  title: string;
  artist: string;
  category: 'Organ' | 'Choral' | 'Vocal' | 'Instrumental' | 'Concert';
  duration: string;
  views: string;
  viewsCount?: number;
  publishedAt: string;
  publishedAtRaw?: string;
  description: string;
  likesCount: number;
  commentCount?: number;
  thumbnailUrl: string;
  tags?: string[];
}

export interface Playlist {
  id: string;
  title: string;
  videoCount: number;
  description: string;
  youtubeUrl: string;
  imageQuery: string;
  thumbnailUrl: string;
  publishedAt?: string;
  channelTitle?: string;
}

export interface ChannelStats {
  subscribers: string;
  subscriberCountRaw?: number;
  videoCount: string;
  totalViews: string;
  totalViewsRaw?: number;
  channelTitle?: string;
  channelDescription?: string;
  handle?: string;
  avatarUrl?: string;
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
