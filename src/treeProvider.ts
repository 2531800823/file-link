/**
 * TreeView 数据提供者
 * 用于在 VS Code 侧边栏显示文件链接的树形结构
 */

import * as vscode from "vscode";
import * as path from "path";
import { FileLink, Category, TreeItemType } from "./types";
import { ConfigManager } from "./config";

/**
 * 文件链接 TreeItem
 * 用于在 TreeView 中显示单个项目
 */
export class FileLinkTreeItem extends vscode.TreeItem {
  /** 节点类型 */
  public readonly itemType: TreeItemType;

  /** 关联的数据对象 */
  public readonly data: FileLink | Category;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    itemType: TreeItemType,
    data: FileLink | Category
  ) {
    super(label, collapsibleState);
    this.itemType = itemType;
    this.data = data;

    if (itemType === TreeItemType.Category) {
      // 目录节点
      this.contextValue = "category";
      this.iconPath = new vscode.ThemeIcon("folder");
    } else {
      // 链接节点
      const link = data as FileLink;
      this.contextValue = "link";
      this.tooltip = link.path;
      this.description = link.path;

      // 设置文件图标
      const ext = path.extname(link.path);
      this.resourceUri = vscode.Uri.parse(`file:///${link.path}`);

      // 点击时打开文件
      this.command = {
        command: "file-link.openLink",
        title: "打开文件",
        arguments: [link.id],
      };
    }
  }
}

/**
 * TreeView 数据提供者
 * 管理文件链接列表的树形显示
 */
export class FileLinkTreeProvider
  implements vscode.TreeDataProvider<FileLinkTreeItem>
{
  /** 数据变更事件发射器 */
  private _onDidChangeTreeData = new vscode.EventEmitter<
    FileLinkTreeItem | undefined | null | void
  >();

  /** 数据变更事件 */
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** 配置管理器 */
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;

    // 监听配置变更
    this.configManager.onConfigChanged(() => {
      this.refresh();
    });
  }

  /**
   * 刷新树形视图
   */
  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * 获取 TreeItem
   */
  public getTreeItem(element: FileLinkTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 获取子节点
   */
  public async getChildren(
    element?: FileLinkTreeItem
  ): Promise<FileLinkTreeItem[]> {
    const items: FileLinkTreeItem[] = [];

    if (!element) {
      // 根节点：显示根目录下的目录和链接
      const rootCategories = this.configManager.getChildCategories(null);
      const rootLinks = this.configManager.getLinksByCategory(null);

      // 先添加目录
      for (const category of rootCategories) {
        items.push(this.createCategoryItem(category));
      }

      // 再添加链接
      for (const link of rootLinks) {
        items.push(await this.createLinkItem(link));
      }
    } else if (element.itemType === TreeItemType.Category) {
      // 目录节点：显示子目录和目录内的链接
      const category = element.data as Category;
      const childCategories = this.configManager.getChildCategories(category.id);
      const linksInCategory = this.configManager.getLinksByCategory(category.id);

      // 先添加子目录
      for (const childCategory of childCategories) {
        items.push(this.createCategoryItem(childCategory));
      }

      // 再添加链接
      for (const link of linksInCategory) {
        items.push(await this.createLinkItem(link));
      }
    }

    return items;
  }

  /**
   * 获取父节点
   */
  public getParent(element: FileLinkTreeItem): FileLinkTreeItem | undefined {
    if (element.itemType === TreeItemType.Category) {
      const category = element.data as Category;
      if (category.parentId) {
        const parentCategory = this.configManager.getCategoryById(
          category.parentId
        );
        if (parentCategory) {
          return this.createCategoryItem(parentCategory);
        }
      }
    } else if (element.itemType === TreeItemType.Link) {
      const link = element.data as FileLink;
      if (link.categoryId) {
        const category = this.configManager.getCategoryById(link.categoryId);
        if (category) {
          return this.createCategoryItem(category);
        }
      }
    }
    return undefined;
  }

  /**
   * 创建目录 TreeItem
   */
  private createCategoryItem(category: Category): FileLinkTreeItem {
    // 检查是否有子节点
    const hasChildren =
      this.configManager.getChildCategories(category.id).length > 0 ||
      this.configManager.getLinksByCategory(category.id).length > 0;

    return new FileLinkTreeItem(
      category.name,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      TreeItemType.Category,
      category
    );
  }

  /**
   * 创建链接 TreeItem
   */
  private async createLinkItem(link: FileLink): Promise<FileLinkTreeItem> {
    // 显示别名或文件名
    const fileName = path.basename(link.path);
    const label = link.alias || fileName;

    const item = new FileLinkTreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      TreeItemType.Link,
      link
    );

    // 构建描述：路径 + 行号信息
    let description = link.path;
    if (link.line !== undefined) {
      description += `:${link.line}`;
      if (link.column !== undefined && link.column > 1) {
        description += `:${link.column}`;
      }
    }

    // 检查文件是否存在
    const exists = await this.configManager.checkFileExists(link.path);
    if (!exists) {
      item.iconPath = new vscode.ThemeIcon(
        "warning",
        new vscode.ThemeColor("errorForeground")
      );
      item.tooltip = `文件不存在: ${link.path}`;
      item.description = `⚠️ ${description}`;
    } else {
      item.description = description;
      // 构建 tooltip
      let tooltip = link.path;
      if (link.line !== undefined) {
        tooltip += `\n行: ${link.line}`;
        if (link.column !== undefined) {
          tooltip += `, 列: ${link.column}`;
        }
      }
      item.tooltip = tooltip;
    }

    return item;
  }

  /**
   * 释放资源
   */
  public dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
