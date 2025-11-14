export enum Type {
  None = 0x00,
  PayloadStart = 0x02,
  PayloadEnd = 0x03,

  /* Appears to set values for an input time.
   * - 222 / DEh  Year
   * - 221 / DDh  Month
   * - 220 / DCh  Day of week
   * - 219 / DBh  Day of month
   * - 218 / DAh  Hour
   * - 217 / D9h  Minute
   */
  ResetTime = 0x06,
  Time = 0x07, // TODO: It seems to set the time used further on.
  If = 0x08,
  Switch = 0x09,
  IfEquals = 0x0c,
  Unknown0A = 0x0a, // TODO
  LineBreak = 0x10,
  // Wait            = 0x11, // Not present anywhere in game data up to 2015.04.17.0001.0000

  /* Font icon.
   * GraphicsFileTextureDefinition is 'common/font/gfdata.gfd'
   * Texture is one of:
   * - 'common/font/fonticon_ps3.tex'
   * - 'common/font/fonticon_ps4.tex'
   * - 'common/font/fonticon_xinput.tex'
   */
  Gui = 0x12,
  Color = 0x13,
  Unknown14 = 0x14, // TODO
  SoftHyphen = 0x16,
  Unknown17 = 0x17, // TODO: Used exclusively in Japanese and at start of new lines.
  Emphasis2 = 0x19, // TODO: See if this is bold, only used very little. 0x1A emphasis is italic.
  Emphasis = 0x1a,
  Indent = 0x1d,
  CommandIcon = 0x1e,
  Dash = 0x1f,
  Value = 0x20,
  Format = 0x22,
  TwoDigitValue = 0x24, // A single-digit value is formatted with a leading zero.
  // Time = 0x25, // Not present anywhere in game data up to 2015.04.17.0001.0000
  Sheet = 0x28,
  Highlight = 0x29,
  Clickable = 0x2b, // Seemingly anything that has an action associated with it (NPCs, PCs, Items, etc.)
  Split = 0x2c,
  Unknown2D = 0x2d, // TODO
  Fixed = 0x2e,
  Unknown2F = 0x2f, // TODO
  SheetJa = 0x30,
  SheetEn = 0x31,
  SheetDe = 0x32,
  SheetFr = 0x33,
  InstanceContent = 0x40, // Presumably so it can be clicked?
  UIForeground = 0x48,
  UIGlow = 0x49,
  RubyCharaters = 0x4a, // Mostly used on Japanese, which means
  ZeroPaddedValue = 0x50,
  Unknown60 = 0x60, // TODO: Used as prefix in Gold Saucer announcements.
}
