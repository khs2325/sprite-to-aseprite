export type SpriteProject = {
  width: number;
  height: number;
  colorMode: "rgba";
  frames: SpriteFrame[];
  layers: SpriteLayer[];
};

export type SpriteFrame = {
  index: number;
  durationMs: number;
};

export type SpriteLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  cels: SpriteCel[];
};

export type SpriteCel = {
  frameIndex: number;
  x: number;
  y: number;
  imageData: ImageData;
};
