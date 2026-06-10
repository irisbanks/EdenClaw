export interface ThumbnailResult {
  thumbnailUrl: string;
  width: number;
  height: number;
  mocked: boolean;
}

export async function createThumbnail(imageUrl: string): Promise<ThumbnailResult> {
  return {
    thumbnailUrl: imageUrl,
    width: 720,
    height: 720,
    mocked: true,
  };
}
