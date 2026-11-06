/** Per-paper opening preference. Original item metadata and files are never reordered or rewritten. */
const PREF = 'extensions.paperweave.preferredAttachments';
export class PreferredAttachments {
  private choices: Record<string, string> = {};
  private original: any;
  private wrapper: any;
  private enabled = false;
  constructor(private host: any) {
    try {
      const saved = JSON.parse(host.Prefs.get(PREF, true) || '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [key, value] of Object.entries(saved)) {
          if (/^\d+:[A-Z0-9]{8}$/.test(key) && typeof value === 'string' && /^[A-Z0-9]{8}$/.test(value)) this.choices[key] = value;
        }
      }
    } catch { /* A malformed local preference falls back to the host's normal order. */ }
  }
  async install() {
    if (this.enabled) return;
    const prototype = this.host.Item.prototype;
    if (typeof prototype.getBestAttachments !== 'function') throw new Error('当前 Zotero 不支持首选附件适配。');
    const manager = this;
    this.original = prototype.getBestAttachments;
    this.wrapper = async function (this: any, ...args: any[]) {
      const items = await manager.original.apply(this, args);
      if (!manager.enabled || !Array.isArray(items)) return items;
      const key = manager.choices[`${this.libraryID}:${this.key}`];
      if (!key) return items;
      const preferred = items.find((a: any) => a.key === key && !a.deleted && a.parentID === this.id && a.isPDFAttachment());
      return preferred ? [preferred, ...items.filter((a: any) => a !== preferred)] : items;
    };
    this.enabled = true;
    prototype.getBestAttachments = this.wrapper;
    await this.clearCaches();
  }
  async select(parent: any, attachment: any) {
    if (!parent?.isRegularItem() || attachment.parentID !== parent.id || attachment.libraryID !== parent.libraryID || !attachment.isPDFAttachment() || attachment.deleted) {
      throw new Error('首选 PDF 必须属于同一篇论文。');
    }
    this.choices[`${parent.libraryID}:${parent.key}`] = attachment.key;
    this.host.Prefs.set(PREF, JSON.stringify(this.choices), true);
    parent.clearBestAttachmentState();
    const selected = await parent.getBestAttachment();
    if (selected?.key !== attachment.key) throw new Error('其他插件可能影响了附件顺序，请在附件列表中打开双语 PDF。');
  }
  private async clearCaches() {
    for (const key of Object.keys(this.choices)) {
      const [libraryID, itemKey] = key.split(':');
      try {
        // Saved choices can refer to items outside the collection loaded at startup.
        // The synchronous getter throws for these items and can abort all UI setup.
        const item = await this.host.Items.getByLibraryAndKeyAsync(Number(libraryID), itemKey);
        item?.clearBestAttachmentState?.();
      } catch (error) {
        // One unavailable item must not prevent menus or other choices from loading.
        this.host.logError?.(error);
      }
    }
  }
  async uninstall() {
    this.enabled = false;
    const prototype = this.host.Item.prototype;
    if (prototype.getBestAttachments === this.wrapper) prototype.getBestAttachments = this.original;
    await this.clearCaches();
  }
}
