/**
 * VS Code 文件链接管理插件主入口
 * 提供文件链接的添加、管理、排序等功能
 */

import * as vscode from "vscode";
import * as path from "path";
import {
  ConfigManager,
  getConfigManager,
  disposeConfigManager,
} from "./config";
import { FileLinkTreeProvider, FileLinkTreeItem } from "./treeProvider";
import { TreeItemType, Category, FileLink, FileLinkConfig } from "./types";

/** TreeView 数据提供者实例 */
let treeProvider: FileLinkTreeProvider | undefined;

/** TreeView 实例 */
let treeView: vscode.TreeView<FileLinkTreeItem> | undefined;

/**
 * 插件激活入口
 */
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log('文件链接管理插件 "file-link" 已激活');

  // 初始化配置管理器
  const configManager = getConfigManager();
  // 设置全局存储路径（配置文件将存储在此目录下）
  configManager.setGlobalStorageUri(context.globalStorageUri);
  await configManager.initialize();

  // 创建 TreeView 提供者
  treeProvider = new FileLinkTreeProvider(configManager);

  // 注册 TreeView
  treeView = vscode.window.createTreeView("fileLinkExplorer", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: false,
    dragAndDropController: createDragAndDropController(configManager, treeProvider),
  });

  // 注册所有命令
  registerCommands(context, configManager, treeProvider);

  // 将 TreeView 添加到订阅中
  context.subscriptions.push(treeView);
}

/**
 * 注册所有命令
 */
function registerCommands(
  context: vscode.ExtensionContext,
  configManager: ConfigManager,
  treeProvider: FileLinkTreeProvider
): void {
  // 添加文件链接（从资源管理器右键菜单）
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.addLink",
      async (uri: vscode.Uri) => {
        await addFileLink(configManager, uri);
      }
    )
  );

  // 添加当前行链接（从编辑器右键菜单或命令面板）
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.addLinkAtLine",
      async () => {
        await addFileLinkAtCurrentLine(configManager);
      }
    )
  );

  // 打开链接
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.openLink",
      async (linkId: string) => {
        await openLink(configManager, linkId);
      }
    )
  );

  // 编辑链接
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.editLink",
      async (item: FileLinkTreeItem) => {
        if (item && item.itemType === TreeItemType.Link) {
          await editLink(configManager, item.data as FileLink);
        }
      }
    )
  );

  // 删除链接
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.deleteLink",
      async (item: FileLinkTreeItem) => {
        if (item && item.itemType === TreeItemType.Link) {
          await deleteLink(configManager, item.data as FileLink);
        }
      }
    )
  );

  // 移动链接到目录
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.moveLink",
      async (item: FileLinkTreeItem) => {
        if (item && item.itemType === TreeItemType.Link) {
          await moveLinkToCategory(configManager, item.data as FileLink);
        }
      }
    )
  );

  // 在资源管理器中显示文件
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.revealInExplorer",
      async (item: FileLinkTreeItem) => {
        if (item && item.itemType === TreeItemType.Link) {
          await revealInExplorer(configManager, item.data as FileLink);
        }
      }
    )
  );

  // 复制路径
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.copyPath",
      async (item: FileLinkTreeItem) => {
        if (item && item.itemType === TreeItemType.Link) {
          await copyPath(configManager, item.data as FileLink);
        }
      }
    )
  );

  // 复制相对路径
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.copyRelativePath",
      async (item: FileLinkTreeItem) => {
        if (item && item.itemType === TreeItemType.Link) {
          await copyRelativePath(item.data as FileLink);
        }
      }
    )
  );

  // 创建目录
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.createCategory",
      async (item?: FileLinkTreeItem) => {
        const parentId =
          item && item.itemType === TreeItemType.Category
            ? (item.data as Category).id
            : null;
        await createCategory(configManager, parentId);
      }
    )
  );

  // 重命名目录
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.renameCategory",
      async (item: FileLinkTreeItem) => {
        if (item && item.itemType === TreeItemType.Category) {
          await renameCategory(configManager, item.data as Category);
        }
      }
    )
  );

  // 删除目录
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "file-link.deleteCategory",
      async (item: FileLinkTreeItem) => {
        if (item && item.itemType === TreeItemType.Category) {
          await deleteCategory(configManager, item.data as Category);
        }
      }
    )
  );

  // 刷新
  context.subscriptions.push(
    vscode.commands.registerCommand("file-link.refresh", () => {
      treeProvider.refresh();
    })
  );

  // 导出配置
  context.subscriptions.push(
    vscode.commands.registerCommand("file-link.exportConfig", async () => {
      await exportConfig(configManager);
    })
  );

  // 导入配置
  context.subscriptions.push(
    vscode.commands.registerCommand("file-link.importConfig", async () => {
      await importConfig(configManager);
    })
  );
}

/**
 * 创建拖拽控制器
 */
function createDragAndDropController(
  configManager: ConfigManager,
  treeProvider: FileLinkTreeProvider
): vscode.TreeDragAndDropController<FileLinkTreeItem> {
  const mimeType = "application/vnd.code.tree.filelinkexplorer";

  return {
    dragMimeTypes: [mimeType],
    dropMimeTypes: [mimeType],

    handleDrag(
      source: readonly FileLinkTreeItem[],
      dataTransfer: vscode.DataTransfer
    ): void {
      if (source.length > 0) {
        const item = source[0];
        dataTransfer.set(
          mimeType,
          new vscode.DataTransferItem(
            JSON.stringify({
              type: item.itemType,
              id:
                item.itemType === TreeItemType.Category
                  ? (item.data as Category).id
                  : (item.data as FileLink).id,
            })
          )
        );
      }
    },

    async handleDrop(
      target: FileLinkTreeItem | undefined,
      dataTransfer: vscode.DataTransfer
    ): Promise<void> {
      const transferItem = dataTransfer.get(mimeType);
      if (!transferItem) {
        return;
      }

      const data = JSON.parse(transferItem.value) as {
        type: TreeItemType;
        id: string;
      };

      // 目标目录ID
      let targetCategoryId: string | null = null;
      if (target) {
        if (target.itemType === TreeItemType.Category) {
          targetCategoryId = (target.data as Category).id;
        } else {
          // 如果拖放到链接上，则移动到该链接所在的目录
          const link = target.data as FileLink;
          targetCategoryId = link.categoryId || null;
        }
      }

      if (data.type === TreeItemType.Link) {
        // 移动链接
        await configManager.moveLinkToCategory(data.id, targetCategoryId);
      } else {
        // 移动目录
        const category = configManager.getCategoryById(data.id);
        if (category) {
          // 防止将目录移动到自身或子目录下
          if (targetCategoryId === data.id) {
            vscode.window.showWarningMessage("不能将目录移动到自身");
            return;
          }
          await configManager.updateCategory(data.id, {
            parentId: targetCategoryId,
          });
        }
      }

      treeProvider.refresh();
    },
  };
}

// ========== 命令实现函数 ==========

/**
 * 添加文件链接
 */
async function addFileLink(
  configManager: ConfigManager,
  uri: vscode.Uri
): Promise<void> {
  if (!uri) {
    // 如果没有传入 URI，让用户选择文件
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "选择文件",
    });

    if (!files || files.length === 0) {
      return;
    }

    uri = files[0];
  }

  // 输入别名
  const alias = await vscode.window.showInputBox({
    prompt: "输入链接别名（可选，留空使用文件名）",
    placeHolder: path.basename(uri.fsPath),
  });

  if (alias === undefined) {
    // 用户取消
    return;
  }

  // 选择目录
  const categories = configManager.getCategories();
  let categoryId: string | undefined;

  if (categories.length > 0) {
    const categoryItems: vscode.QuickPickItem[] = [
      { label: "$(folder) 根目录", description: "不放入任何目录" },
      ...buildCategoryQuickPickItems(configManager, null, 0),
    ];

    const selectedCategory = await vscode.window.showQuickPick(categoryItems, {
      placeHolder: "选择目录（可选）",
    });

    if (selectedCategory && selectedCategory.label !== "$(folder) 根目录") {
      // 从描述中提取 ID
      const match = selectedCategory.description?.match(/\[id:(.+?)\]/);
      if (match) {
        categoryId = match[1];
      }
    }
  }

  try {
    await configManager.addLink(uri.fsPath, alias || undefined, categoryId);
    vscode.window.showInformationMessage("文件链接添加成功");
  } catch (error) {
    vscode.window.showErrorMessage(`添加链接失败: ${error}`);
  }
}

/**
 * 构建目录选择项列表
 */
function buildCategoryQuickPickItems(
  configManager: ConfigManager,
  parentId: string | null,
  level: number
): vscode.QuickPickItem[] {
  const items: vscode.QuickPickItem[] = [];
  const categories = configManager.getChildCategories(parentId);

  for (const category of categories) {
    const indent = "  ".repeat(level);
    items.push({
      label: `${indent}$(folder) ${category.name}`,
      description: `[id:${category.id}]`,
    });

    // 递归添加子目录
    items.push(
      ...buildCategoryQuickPickItems(configManager, category.id, level + 1)
    );
  }

  return items;
}

/**
 * 打开链接
 */
async function openLink(
  configManager: ConfigManager,
  linkId: string
): Promise<void> {
  const link = configManager.getLinkById(linkId);
  if (!link) {
    vscode.window.showErrorMessage("链接不存在");
    return;
  }

  const fileUri = configManager.getFileUri(link.path);
  if (!fileUri) {
    vscode.window.showErrorMessage("无法获取文件路径");
    return;
  }

  // 检查文件是否存在
  const exists = await configManager.checkFileExists(link.path);
  if (!exists) {
    const action = await vscode.window.showWarningMessage(
      `文件不存在: ${link.path}`,
      "删除链接",
      "编辑路径"
    );

    if (action === "删除链接") {
      await configManager.deleteLink(linkId);
    } else if (action === "编辑路径") {
      await editLink(configManager, link);
    }
    return;
  }

  // 打开文件
  try {
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    // 如果设置了行号，跳转到指定位置
    if (link.line !== undefined && link.line > 0) {
      const line = link.line - 1; // VS Code 行号从0开始
      const column = (link.column ?? 1) - 1; // 列号也从0开始
      const position = new vscode.Position(line, column);
      const selection = new vscode.Selection(position, position);
      editor.selection = selection;
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`打开文件失败: ${error}`);
  }
}

/**
 * 编辑链接
 */
async function editLink(
  configManager: ConfigManager,
  link: FileLink
): Promise<void> {
  // 选择要编辑的内容
  const editOptions = [
    { label: "$(edit) 编辑别名", value: "alias" },
    { label: "$(file) 编辑路径", value: "path" },
    { label: "$(location) 编辑行号", value: "line" },
  ];

  const editOption = await vscode.window.showQuickPick(editOptions, {
    placeHolder: "选择要编辑的内容",
  });

  if (!editOption) {
    return;
  }

  if (editOption.value === "alias") {
    const newAlias = await vscode.window.showInputBox({
      prompt: "输入新的别名（留空使用文件名）",
      value: link.alias || "",
      placeHolder: path.basename(link.path),
    });

    if (newAlias === undefined) {
      return;
    }

    await configManager.updateLink(link.id, {
      alias: newAlias || undefined,
    });
    vscode.window.showInformationMessage("别名已更新");
  } else if (editOption.value === "path") {
    const newPath = await vscode.window.showInputBox({
      prompt: "输入新的文件路径（相对于项目根目录）",
      value: link.path,
    });

    if (!newPath) {
      return;
    }

    // 验证路径是否存在
    const exists = await configManager.checkFileExists(newPath);
    if (!exists) {
      const confirm = await vscode.window.showWarningMessage(
        "文件不存在，确定要保存吗？",
        "确定",
        "取消"
      );
      if (confirm !== "确定") {
        return;
      }
    }

    await configManager.updateLink(link.id, { path: newPath });
    vscode.window.showInformationMessage("路径已更新");
  } else if (editOption.value === "line") {
    // 编辑行号
    const currentLine = link.line !== undefined ? String(link.line) : "";
    const lineInput = await vscode.window.showInputBox({
      prompt: "输入行号（留空则不跳转到特定行）",
      value: currentLine,
      placeHolder: "例如: 42",
      validateInput: (value) => {
        if (value && !/^\d+$/.test(value)) {
          return "请输入有效的行号（正整数）";
        }
        return null;
      },
    });

    if (lineInput === undefined) {
      return;
    }

    const newLine = lineInput ? parseInt(lineInput, 10) : undefined;

    // 如果设置了行号，询问是否设置列号
    let newColumn: number | undefined;
    if (newLine) {
      const currentColumn = link.column !== undefined ? String(link.column) : "1";
      const columnInput = await vscode.window.showInputBox({
        prompt: "输入列号（可选，默认为1）",
        value: currentColumn,
        placeHolder: "例如: 1",
        validateInput: (value) => {
          if (value && !/^\d+$/.test(value)) {
            return "请输入有效的列号（正整数）";
          }
          return null;
        },
      });

      if (columnInput === undefined) {
        return;
      }

      newColumn = columnInput ? parseInt(columnInput, 10) : undefined;
    }

    await configManager.updateLink(link.id, {
      line: newLine,
      column: newColumn,
    });
    vscode.window.showInformationMessage(
      newLine ? `行号已更新为 ${newLine}` : "行号已清除"
    );
  }
}

/**
 * 添加当前行的文件链接
 */
async function addFileLinkAtCurrentLine(
  configManager: ConfigManager
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("请先打开一个文件");
    return;
  }

  const document = editor.document;
  const position = editor.selection.active;
  const line = position.line + 1; // 转换为1-based
  const column = position.character + 1; // 转换为1-based

  // 获取当前行的内容作为默认别名的参考
  const lineText = document.lineAt(position.line).text.trim();
  const defaultAlias = lineText.length > 30 ? lineText.substring(0, 30) + "..." : lineText;

  // 输入别名
  const alias = await vscode.window.showInputBox({
    prompt: `输入链接别名（当前位置: 第${line}行）`,
    placeHolder: defaultAlias || path.basename(document.uri.fsPath),
    value: "",
  });

  if (alias === undefined) {
    // 用户取消
    return;
  }

  // 选择目录
  const categories = configManager.getCategories();
  let categoryId: string | undefined;

  if (categories.length > 0) {
    const categoryItems: vscode.QuickPickItem[] = [
      { label: "$(folder) 根目录", description: "不放入任何目录" },
      ...buildCategoryQuickPickItems(configManager, null, 0),
    ];

    const selectedCategory = await vscode.window.showQuickPick(categoryItems, {
      placeHolder: "选择目录（可选）",
    });

    if (selectedCategory && selectedCategory.label !== "$(folder) 根目录") {
      // 从描述中提取 ID
      const match = selectedCategory.description?.match(/\[id:(.+?)\]/);
      if (match) {
        categoryId = match[1];
      }
    }
  }

  try {
    await configManager.addLink(
      document.uri.fsPath,
      alias || undefined,
      categoryId,
      line,
      column
    );
    vscode.window.showInformationMessage(
      `文件链接添加成功（第${line}行）`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`添加链接失败: ${error}`);
  }
}

/**
 * 删除链接
 */
async function deleteLink(
  configManager: ConfigManager,
  link: FileLink
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `确定要删除链接 "${link.alias || path.basename(link.path)}" 吗？`,
    "确定",
    "取消"
  );

  if (confirm === "确定") {
    await configManager.deleteLink(link.id);
    vscode.window.showInformationMessage("链接已删除");
  }
}

/**
 * 移动链接到目录
 */
async function moveLinkToCategory(
  configManager: ConfigManager,
  link: FileLink
): Promise<void> {
  const categoryItems: vscode.QuickPickItem[] = [
    { label: "$(folder) 根目录", description: "移动到根目录" },
    ...buildCategoryQuickPickItems(configManager, null, 0),
  ];

  const selectedCategory = await vscode.window.showQuickPick(categoryItems, {
    placeHolder: "选择目标目录",
  });

  if (!selectedCategory) {
    return;
  }

  let targetCategoryId: string | null = null;
  if (selectedCategory.label !== "$(folder) 根目录") {
    const match = selectedCategory.description?.match(/\[id:(.+?)\]/);
    if (match) {
      targetCategoryId = match[1];
    }
  }

  await configManager.moveLinkToCategory(link.id, targetCategoryId);
  vscode.window.showInformationMessage("链接已移动");
}

/**
 * 在资源管理器中显示文件
 */
async function revealInExplorer(
  configManager: ConfigManager,
  link: FileLink
): Promise<void> {
  const fileUri = configManager.getFileUri(link.path);
  if (!fileUri) {
    vscode.window.showErrorMessage("无法获取文件路径");
    return;
  }

  const exists = await configManager.checkFileExists(link.path);
  if (!exists) {
    vscode.window.showErrorMessage(`文件不存在: ${link.path}`);
    return;
  }

  await vscode.commands.executeCommand("revealInExplorer", fileUri);
}

/**
 * 复制文件路径到剪贴板（绝对路径）
 */
async function copyPath(
  configManager: ConfigManager,
  link: FileLink
): Promise<void> {
  const fileUri = configManager.getFileUri(link.path);
  if (!fileUri) {
    vscode.window.showErrorMessage("无法获取文件路径");
    return;
  }

  // 复制绝对路径到剪贴板
  await vscode.env.clipboard.writeText(fileUri.fsPath);
  vscode.window.showInformationMessage("路径已复制到剪贴板");
}

/**
 * 复制文件相对路径到剪贴板
 */
async function copyRelativePath(link: FileLink): Promise<void> {
  // link.path 本身就是相对路径
  await vscode.env.clipboard.writeText(link.path);
  vscode.window.showInformationMessage("相对路径已复制到剪贴板");
}

/**
 * 创建目录
 */
async function createCategory(
  configManager: ConfigManager,
  parentId: string | null
): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "输入目录名称",
    placeHolder: "新目录",
  });

  if (!name) {
    return;
  }

  try {
    await configManager.createCategory(name, parentId);
    vscode.window.showInformationMessage(`目录 "${name}" 创建成功`);
  } catch (error) {
    vscode.window.showErrorMessage(`创建目录失败: ${error}`);
  }
}

/**
 * 重命名目录
 */
async function renameCategory(
  configManager: ConfigManager,
  category: Category
): Promise<void> {
  const newName = await vscode.window.showInputBox({
    prompt: "输入新的目录名称",
    value: category.name,
  });

  if (!newName || newName === category.name) {
    return;
  }

  try {
    await configManager.updateCategory(category.id, { name: newName });
    vscode.window.showInformationMessage(`目录已重命名为 "${newName}"`);
  } catch (error) {
    vscode.window.showErrorMessage(`重命名目录失败: ${error}`);
  }
}

/**
 * 删除目录
 */
async function deleteCategory(
  configManager: ConfigManager,
  category: Category
): Promise<void> {
  const linksInCategory = configManager.getLinksByCategory(category.id);
  const childCategories = configManager.getChildCategories(category.id);

  let message = `确定要删除目录 "${category.name}" 吗？`;
  if (linksInCategory.length > 0 || childCategories.length > 0) {
    message += `\n目录下有 ${linksInCategory.length} 个链接和 ${childCategories.length} 个子目录。`;
  }

  const options = ["删除目录（保留链接）", "删除目录和所有链接", "取消"];
  const action = await vscode.window.showWarningMessage(message, ...options);

  if (action === "删除目录（保留链接）") {
    await configManager.deleteCategory(category.id, false);
    vscode.window.showInformationMessage("目录已删除，链接已移至根目录");
  } else if (action === "删除目录和所有链接") {
    await configManager.deleteCategory(category.id, true);
    vscode.window.showInformationMessage("目录及其所有链接已删除");
  }
}

/**
 * 导出配置
 */
async function exportConfig(configManager: ConfigManager): Promise<void> {
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file("file-links-export.json"),
    filters: { JSON: ["json"] },
  });

  if (!saveUri) {
    return;
  }

  try {
    const content = await configManager.exportConfig();
    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, "utf-8"));
    vscode.window.showInformationMessage("配置导出成功");
  } catch (error) {
    vscode.window.showErrorMessage(`导出配置失败: ${error}`);
  }
}

/**
 * 导入配置
 */
async function importConfig(configManager: ConfigManager): Promise<void> {
  const openUri = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { JSON: ["json"] },
    openLabel: "导入配置",
  });

  if (!openUri || openUri.length === 0) {
    return;
  }

  try {
    const content = await vscode.workspace.fs.readFile(openUri[0]);
    const config = JSON.parse(
      Buffer.from(content).toString("utf-8")
    ) as FileLinkConfig;

    // 选择导入模式
    const mode = await vscode.window.showQuickPick(
      [
        { label: "合并", description: "将导入的配置合并到现有配置", value: true },
        {
          label: "替换",
          description: "用导入的配置替换现有配置",
          value: false,
        },
      ],
      { placeHolder: "选择导入模式" }
    );

    if (!mode) {
      return;
    }

    const result = await configManager.importConfig(config, mode.value);

    if (result.invalid.length > 0) {
      const invalidPaths = result.invalid.map((l) => l.path).join("\n");
      vscode.window.showWarningMessage(
        `导入完成，但有 ${result.invalid.length} 个文件不存在:\n${invalidPaths}`
      );
    } else {
      vscode.window.showInformationMessage(
        `成功导入 ${result.valid.length} 个链接`
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`导入配置失败: ${error}`);
  }
}

/**
 * 插件停用入口
 */
export function deactivate(): void {
  treeProvider?.dispose();
  disposeConfigManager();
  console.log('文件链接管理插件 "file-link" 已停用');
}
