// Core document model for CHRISCO Design Room.
// Mirrors the persistence schema: Design / Page / Element / Asset / Template.

export type Background =
  | string
  | { angle: number; from: string; to: string };

export interface Design {
  id: string;
  title: string;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  /** Sample content is clearly marked and never mixed into user-created designs. */
  sample?: boolean;
}

export interface Page {
  id: string;
  designId: string;
  background: Background;
  order: number;
}

export type ElementType = 'text' | 'shape' | 'image';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  italic: boolean;
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'star' | 'line';

export interface ShapeStyle {
  shape: ShapeKind;
  fill: string;
  radius: number;
}

export interface ImageStyle {
  radius: number;
}

/** Crop state: image drawn at offset (ox, oy) with uniform scale s of its natural size. */
export interface ImageCrop {
  ox: number;
  oy: number;
  s: number;
}

export interface TextContent {
  text: string;
}
export interface ShapeContent {
  placeholder?: never;
}
export interface ImageContent {
  assetId: string;
  crop: ImageCrop | null;
}

export interface DesignElement {
  id: string;
  pageId: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  order: number;
  content: TextContent | ShapeContent | ImageContent;
  style: TextStyle | ShapeStyle | ImageStyle;
}

export interface Asset {
  id: string;
  designId: string;
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface TemplateDef {
  id: string;
  name: string;
  category: string;
  width: number;
  height: number;
  background: Background;
  elements: TemplateElement[];
}

export interface TemplateElement {
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  content: TextContent | ShapeContent | ImageContent;
  style: TextStyle | ShapeStyle | ImageStyle;
}

/** The in-memory working document (all pages of one design). */
export interface DesignDoc {
  design: Design;
  pages: Page[];
  elements: DesignElement[];
}

export function isText(el: DesignElement): el is DesignElement & { content: TextContent; style: TextStyle } {
  return el.type === 'text';
}
export function isShape(el: DesignElement): el is DesignElement & { content: ShapeContent; style: ShapeStyle } {
  return el.type === 'shape';
}
export function isImage(el: DesignElement): el is DesignElement & { content: ImageContent; style: ImageStyle } {
  return el.type === 'image';
}
