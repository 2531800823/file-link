/**
 * 配置管理器
 * 负责读取、写入和管理文件链接配置
 */

import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import {
  FileLinkConfig,
  FileLink,
  Category,
  DEFAULT_CONFIG,
  ImportValidationResult,
} from "./types";

/**
 * 配置管理器类
 * 处理配置文件的读写、链接和目录的增删改查
 */
export class ConfigManager {
  /** 当前配置 */
  private config: FileLinkConfig = { ...DEFAULT_CONFIG };

  /** 配置变更事件发射器 */
  private _onConfigChanged = new vscode.EventEmitter<void>();

  /** 配置变更事件 */
  public readonly onConfigChanged = this._onConfigChanged.event;

  /** 全局存储路径 */
  private globalStorageUri: vscode.Uri | undefined;

  /**
   * 设置全局存储路径
   */
  public setGlobalStorageUri(uri: vscode.Uri): void {
    this.globalStorageUri = uri;
  }

  /**
   * 根据工作区路径生成唯一的配置文件名
   * 使用工作区路径的 hash 作为文件名，避免不同项目的配置冲突
   */
  private getWorkspaceConfigFileName(): string {
    const workspaceUri = this.getWorkspaceUri();
    if (!workspaceUri) {
      return "default.json";
    }
    // 使用 MD5 hash 生成唯一标识
    const hash = crypto.createHash("md5").update(workspaceUri.fsPath).digest("hex");
    return `${hash}.json`;
  }

  /**
   * 获取配置文件的 URI（存储在全局存储目录中）
   */
  private getConfigUri(): vscode.Uri | undefined {
    if (!this.globalStorageUri) {
      return undefined;
    }
    return vscode.Uri.joinPath(this.globalStorageUri, this.getWorkspaceConfigFileName());
  }

  /**
   * 获取工作区根目录 URI
   */
  public getWorkspaceUri(): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    return workspaceFolders[0].uri;
  }

  /**
   * 初始化配置管理器，加载配置文件
   */
  public async initialize(): Promise<void> {
    // 确保全局存储目录存在
    if (this.globalStorageUri) {
      try {
        await vscode.workspace.fs.createDirectory(this.globalStorageUri);
      } catch {
        // 目录可能已存在，忽略错误
      }
    }
    await this.loadConfig();
  }

  /**
   * 加载配置文件
   */
  public async loadConfig(): Promise<void> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      this.config = { ...DEFAULT_CONFIG };
      return;
    }

    try {
      const fileContent = await vscode.workspace.fs.readFile(configUri);
      const content = Buffer.from(fileContent).toString("utf-8");
      const parsed = JSON.parse(content) as FileLinkConfig;

      // 验证并合并配置
      this.config = {
        version: parsed.version || DEFAULT_CONFIG.version,
        links: Array.isArray(parsed.links) ? parsed.links : [],
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      };
    } catch {
      // 配置文件不存在或解析失败，使用默认配置
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  /**
   * 保存配置文件
   */
  public async saveConfig(): Promise<void> {
    const configUri = this.getConfigUri();
    if (!configUri) {
      vscode.window.showErrorMessage("未打开工作区，无法保存配置");
      return;
    }

    try {
      const content = JSON.stringify(this.config, null, 2);
      await vscode.workspace.fs.writeFile(
        configUri,
        Buffer.from(content, "utf-8")
      );
      this._onConfigChanged.fire();
    } catch (error) {
      vscode.window.showErrorMessage(`保存配置失败: ${error}`);
    }
  }

  /**
   * 获取当前配置
   */
  public getConfig(): FileLinkConfig {
    return this.config;
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ========== 链接管理 ==========

  /**
   * 获取所有链接
   */
  public getLinks(): FileLink[] {
    return this.config.links;
  }

  /**
   * 根据ID获取链接
   */
  public getLinkById(id: string): FileLink | undefined {
    return this.config.links.find((link) => link.id === id);
  }

  /**
   * 获取指定目录下的链接
   */
  public getLinksByCategory(categoryId: string | null): FileLink[] {
    return this.config.links
      .filter((link) =>
        categoryId === null
          ? !link.categoryId
          : link.categoryId === categoryId
      )
      .sort((a, b) => a.order - b.order);
  }

  /**
   * 添加文件链接
   * @param filePath 文件绝对路径
   * @param alias 别名
   * @param categoryId 目录ID
   * @param line 行号（从1开始）
   * @param column 列号（从1开始）
   */
  public async addLink(
    filePath: string,
    alias?: string,
    categoryId?: string,
    line?: number,
    column?: number
  ): Promise<FileLink> {
    const workspaceUri = this.getWorkspaceUri();
    if (!workspaceUri) {
      throw new Error("未打开工作区");
    }

    // 转换为相对路径
    const relativePath = path.relative(workspaceUri.fsPath, filePath);

    // 计算排序序号
    const linksInCategory = this.getLinksByCategory(categoryId || null);
    const maxOrder =
      linksInCategory.length > 0
        ? Math.max(...linksInCategory.map((l) => l.order))
        : -1;

    const newLink: FileLink = {
      id: this.generateId(),
      path: relativePath.replace(/\\/g, "/"), // 统一使用正斜杠
      alias: alias || undefined,
      categoryId: categoryId || undefined,
      line: line,
      column: column,
      order: maxOrder + 1,
    };

    this.config.links.push(newLink);
    await this.saveConfig();

    return newLink;
  }

  /**
   * 更新文件链接
   */
  public async updateLink(
    id: string,
    updates: Partial<Omit<FileLink, "id">>
  ): Promise<void> {
    const linkIndex = this.config.links.findIndex((l) => l.id === id);
    if (linkIndex === -1) {
      throw new Error("链接不存在");
    }

    this.config.links[linkIndex] = {
      ...this.config.links[linkIndex],
      ...updates,
    };
    await this.saveConfig();
  }

  /**
   * 删除文件链接
   */
  public async deleteLink(id: string): Promise<void> {
    this.config.links = this.config.links.filter((l) => l.id !== id);
    await this.saveConfig();
  }

  /**
   * 移动链接到指定目录
   */
  public async moveLinkToCategory(
    linkId: string,
    categoryId: string | null
  ): Promise<void> {
    const link = this.getLinkById(linkId);
    if (!link) {
      throw new Error("链接不存在");
    }

    // 计算新目录下的排序序号
    const linksInCategory = this.getLinksByCategory(categoryId);
    const maxOrder =
      linksInCategory.length > 0
        ? Math.max(...linksInCategory.map((l) => l.order))
        : -1;

    await this.updateLink(linkId, {
      categoryId: categoryId || undefined,
      order: maxOrder + 1,
    });
  }

  /**
   * 重新排序链接
   */
  public async reorderLinks(
    linkIds: string[],
    categoryId: string | null
  ): Promise<void> {
    linkIds.forEach((id, index) => {
      const link = this.getLinkById(id);
      if (link) {
        link.order = index;
      }
    });
    await this.saveConfig();
  }

  // ========== 目录管理 ==========

  /**
   * 获取所有目录
   */
  public getCategories(): Category[] {
    return this.config.categories;
  }

  /**
   * 根据ID获取目录
   */
  public getCategoryById(id: string): Category | undefined {
    return this.config.categories.find((cat) => cat.id === id);
  }

  /**
   * 获取子目录
   */
  public getChildCategories(parentId: string | null): Category[] {
    return this.config.categories
      .filter((cat) => cat.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * 创建目录
   */
  public async createCategory(
    name: string,
    parentId: string | null = null
  ): Promise<Category> {
    // 计算排序序号
    const siblings = this.getChildCategories(parentId);
    const maxOrder =
      siblings.length > 0 ? Math.max(...siblings.map((c) => c.order)) : -1;

    const newCategory: Category = {
      id: this.generateId(),
      name,
      order: maxOrder + 1,
      parentId,
    };

    this.config.categories.push(newCategory);
    await this.saveConfig();

    return newCategory;
  }

  /**
   * 更新目录
   */
  public async updateCategory(
    id: string,
    updates: Partial<Omit<Category, "id">>
  ): Promise<void> {
    const categoryIndex = this.config.categories.findIndex((c) => c.id === id);
    if (categoryIndex === -1) {
      throw new Error("目录不存在");
    }

    this.config.categories[categoryIndex] = {
      ...this.config.categories[categoryIndex],
      ...updates,
    };
    await this.saveConfig();
  }

  /**
   * 删除目录
   * @param id 目录ID
   * @param deleteLinks 是否删除目录内的链接，false则将链接移到根目录
   */
  public async deleteCategory(
    id: string,
    deleteLinks: boolean = false
  ): Promise<void> {
    // 递归获取所有子目录ID
    const getAllChildCategoryIds = (parentId: string): string[] => {
      const children = this.getChildCategories(parentId);
      let ids: string[] = [];
      for (const child of children) {
        ids.push(child.id);
        ids = ids.concat(getAllChildCategoryIds(child.id));
      }
      return ids;
    };

    const categoryIdsToDelete = [id, ...getAllChildCategoryIds(id)];

    // 处理目录内的链接
    if (deleteLinks) {
      // 删除所有相关链接
      this.config.links = this.config.links.filter(
        (link) => !link.categoryId || !categoryIdsToDelete.includes(link.categoryId)
      );
    } else {
      // 将链接移到根目录
      this.config.links = this.config.links.map((link) => {
        if (link.categoryId && categoryIdsToDelete.includes(link.categoryId)) {
          return { ...link, categoryId: undefined };
        }
        return link;
      });
    }

    // 删除目录
    this.config.categories = this.config.categories.filter(
      (cat) => !categoryIdsToDelete.includes(cat.id)
    );

    await this.saveConfig();
  }

  /**
   * 重新排序目录
   */
  public async reorderCategories(
    categoryIds: string[],
    parentId: string | null
  ): Promise<void> {
    categoryIds.forEach((id, index) => {
      const category = this.getCategoryById(id);
      if (category) {
        category.order = index;
      }
    });
    await this.saveConfig();
  }

  // ========== 导入导出 ==========

  /**
   * 导出配置
   */
  public async exportConfig(): Promise<string> {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * 验证导入的配置
   */
  public async validateImport(
    config: FileLinkConfig
  ): Promise<ImportValidationResult> {
    const workspaceUri = this.getWorkspaceUri();
    if (!workspaceUri) {
      throw new Error("未打开工作区");
    }

    const valid: FileLink[] = [];
    const invalid: FileLink[] = [];

    for (const link of config.links) {
      const fileUri = vscode.Uri.joinPath(workspaceUri, link.path);
      try {
        await vscode.workspace.fs.stat(fileUri);
        valid.push(link);
      } catch {
        invalid.push(link);
      }
    }

    return { valid, invalid };
  }

  /**
   * 导入配置
   * @param config 要导入的配置
   * @param merge 是否合并（true: 合并到现有配置，false: 替换现有配置）
   */
  public async importConfig(
    config: FileLinkConfig,
    merge: boolean = false
  ): Promise<ImportValidationResult> {
    const validation = await this.validateImport(config);

    if (merge) {
      // 合并模式：添加新的链接和目录
      // 为导入的项生成新ID避免冲突
      const idMap = new Map<string, string>();

      // 先处理目录
      for (const category of config.categories) {
        const newId = this.generateId();
        idMap.set(category.id, newId);
        
        this.config.categories.push({
          ...category,
          id: newId,
          parentId: category.parentId ? idMap.get(category.parentId) || null : null,
        });
      }

      // 再处理链接（只导入有效的）
      for (const link of validation.valid) {
        this.config.links.push({
          ...link,
          id: this.generateId(),
          categoryId: link.categoryId ? idMap.get(link.categoryId) : undefined,
        });
      }
    } else {
      // 替换模式：只导入有效的链接
      this.config = {
        version: config.version,
        links: validation.valid.map((link) => ({
          ...link,
          id: this.generateId(),
        })),
        categories: config.categories.map((cat) => ({
          ...cat,
          id: this.generateId(),
        })),
      };
    }

    await this.saveConfig();
    return validation;
  }

  /**
   * 检查文件是否存在
   */
  public async checkFileExists(relativePath: string): Promise<boolean> {
    const workspaceUri = this.getWorkspaceUri();
    if (!workspaceUri) {
      return false;
    }

    const fileUri = vscode.Uri.joinPath(workspaceUri, relativePath);
    try {
      await vscode.workspace.fs.stat(fileUri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取文件的绝对路径 URI
   */
  public getFileUri(relativePath: string): vscode.Uri | undefined {
    const workspaceUri = this.getWorkspaceUri();
    if (!workspaceUri) {
      return undefined;
    }
    return vscode.Uri.joinPath(workspaceUri, relativePath);
  }

  /**
   * 释放资源
   */
  public dispose(): void {
    this._onConfigChanged.dispose();
  }
}

/** 全局配置管理器实例 */
let configManagerInstance: ConfigManager | undefined;

/**
 * 获取配置管理器实例（单例模式）
 */
export function getConfigManager(): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager();
  }
  return configManagerInstance;
}

/**
 * 销毁配置管理器实例
 */
export function disposeConfigManager(): void {
  if (configManagerInstance) {
    configManagerInstance.dispose();
    configManagerInstance = undefined;
  }
}
