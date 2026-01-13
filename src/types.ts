/**
 * 文件链接管理插件的类型定义
 */

/**
 * 文件链接项
 */
export interface FileLink {
  /** 唯一标识符 */
  id: string;
  /** 文件相对路径（基于项目根目录） */
  path: string;
  /** 链接别名，如果没有设置则使用文件名 */
  alias?: string;
  /** 所属目录ID */
  categoryId?: string;
  /** 排序序号 */
  order: number;
  /** 行号（从1开始），如果设置则跳转到指定行 */
  line?: number;
  /** 列号（从1开始），如果设置则跳转到指定列 */
  column?: number;
}

/**
 * 目录/分类
 */
export interface Category {
  /** 唯一标识符 */
  id: string;
  /** 目录名称 */
  name: string;
  /** 排序序号 */
  order: number;
  /** 父目录ID，null表示根目录 */
  parentId: string | null;
}

/**
 * 配置文件数据结构
 */
export interface FileLinkConfig {
  /** 配置文件版本 */
  version: string;
  /** 文件链接列表 */
  links: FileLink[];
  /** 目录/分类列表 */
  categories: Category[];
}

/**
 * TreeView 项类型
 */
export enum TreeItemType {
  /** 目录/分类 */
  Category = "category",
  /** 文件链接 */
  Link = "link",
}

/**
 * TreeView 节点数据
 */
export interface TreeItemData {
  /** 节点类型 */
  type: TreeItemType;
  /** 对应的数据对象 */
  data: FileLink | Category;
}

/**
 * 导入验证结果
 */
export interface ImportValidationResult {
  /** 验证通过的链接 */
  valid: FileLink[];
  /** 验证失败的链接（文件不存在） */
  invalid: FileLink[];
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: FileLinkConfig = {
  version: "1.0.0",
  links: [],
  categories: [],
};
