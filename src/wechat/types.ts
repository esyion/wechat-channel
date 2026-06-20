/**
 * WeChat ilink protocol types.
 * Mirrors the JSON shapes used by ilinkai.weixin.qq.com.
 */

export interface BaseInfo {
  channel_version?: string;
  bot_agent?: string;
}

export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;
export type UploadMediaTypeValue = (typeof UploadMediaType)[keyof typeof UploadMediaType];

export const MessageType = {
  USER: 1,
  BOT: 2,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export interface TextItem {
  text?: string;
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string; // base64-encoded bytes
  encrypt_type?: number;
  full_url?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  /** Raw AES-128 key as hex string (16 bytes). Preferred over media.aes_key for inbound images. */
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;
  bits_per_sample?: number;
  sample_rate?: number;
  playtime?: number;
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string;
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  /** Required to be echoed verbatim on outbound send. */
  context_token?: string;
}

export interface GetUpdatesReq {
  get_updates_buf?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageReq {
  msg?: {
    from_user_id?: string;
    to_user_id?: string;
    client_id?: string;
    message_type?: number;
    message_state?: number;
    item_list?: MessageItem[];
    context_token?: string;
  };
}

export interface GetUploadUrlReq {
  filekey?: string;
  media_type?: number;
  to_user_id?: string;
  rawsize?: number;
  rawfilemd5?: string;
  filesize?: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
  no_need_thumb?: boolean;
  aeskey?: string;
}

export interface GetUploadUrlResp {
  upload_param?: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

export interface UploadedFileInfo {
  filekey: string;
  downloadEncryptedQueryParam: string;
  /** Hex-encoded raw 16-byte AES key */
  aeskey: string;
  /** Plaintext file size in bytes */
  fileSize: number;
  /** Ciphertext file size in bytes (AES-128-ECB + PKCS7) */
  fileSizeCiphertext: number;
}

export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  status?: number;
}

export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

export interface NotifyResp {
  ret?: number;
  errmsg?: string;
}
