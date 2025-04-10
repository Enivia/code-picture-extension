// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import { createCanvas } from "canvas";
import hljs from "highlight.js";
import * as tmp from "tmp";
import { getLocaleMessage, LocaleMessages } from "./i18n";

interface ColorSpan {
  text: string;
  color: string;
  start: number;
}

interface WrappedLine {
  spans: ColorSpan[];
  indent: number;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const i18n = getLocaleMessage();
  console.log(i18n.extension.activated);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json

  // 导出代码图片命令
  const exportToImage = vscode.commands.registerCommand("code-picture.exportToImage", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(i18n.error.noEditor);
      return;
    }

    const selection = editor.selection;
    const code = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
    const language = editor.document.languageId;

    try {
      const imageBuffer = await codeToImage(code, language);

      // 选择保存路径
      const uri = await vscode.window.showSaveDialog({
        filters: {
          Images: ["png"],
        },
      });

      if (uri) {
        fs.writeFileSync(uri.fsPath, imageBuffer);
        vscode.window.showInformationMessage(i18n.success.exported);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : i18n.error.exportFailed;
      vscode.window.showErrorMessage(`${i18n.error.exportFailed}: ${errorMessage}`);
    }
  });

  // 复制代码图片到剪贴板命令
  const copyToClipboard = vscode.commands.registerCommand(
    "code-picture.copyToClipboard",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(i18n.error.noEditor);
        return;
      }

      const selection = editor.selection;
      const code = selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(selection);
      const language = editor.document.languageId;

      try {
        const imageBuffer = await codeToImage(code, language);

        // 创建临时文件来存储图片
        const tmpFile = tmp.fileSync({ postfix: ".png" });
        fs.writeFileSync(tmpFile.name, imageBuffer);

        // 根据操作系统选择复制命令
        const platform = process.platform;
        let command;

        if (platform === "darwin") {
          command = `osascript -e 'set the clipboard to (read (POSIX file "${tmpFile.name}") as JPEG picture)'`;
        } else if (platform === "win32") {
          command = `powershell -command "Set-Clipboard -Path '${tmpFile.name}'"`;
        } else {
          command = `xclip -selection clipboard -t image/png -i "${tmpFile.name}"`;
        }

        // 执行复制命令
        const { exec } = require("child_process");
        exec(command, (error: Error | null) => {
          if (error) {
            vscode.window.showErrorMessage(`${i18n.error.copyFailed}: ${error.message}`);
          } else {
            vscode.window.showInformationMessage(i18n.success.copied);
          }
          // 清理临时文件
          tmpFile.removeCallback();
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : i18n.error.copyFailed;
        vscode.window.showErrorMessage(`${i18n.error.copyFailed}: ${errorMessage}`);
      }
    }
  );

  context.subscriptions.push(exportToImage, copyToClipboard);
}

// This method is called when your extension is deactivated
export function deactivate() {}

const entities: { [key: string]: string } = {
  "&quot;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#39;": "'",
  "&apos;": "'",
};

// 解析HTML获取颜色信息
const colorMap: { [key: string]: string } = {
  "hljs-keyword": "#C678DD",
  "hljs-string": "#98C379",
  "hljs-number": "#D19A66",
  "hljs-comment": "#5C6370",
  "hljs-function": "#61AFEF",
  "hljs-title": "#61AFEF",
  "hljs-params": "#ABB2BF",
  "hljs-built_in": "#E6C07B",
  "hljs-literal": "#56B6C2",
  "hljs-type": "#E6C07B",
  "hljs-meta": "#ABB2BF",
  "hljs-operator": "#56B6C2",
  "hljs-property": "#E06C75",
  "hljs-variable": "#E06C75",
};

// HTML实体解码函数
function decodeHTMLEntities(text: string): string {
  if (!text) return "";
  return text.replace(
    /&quot;|&amp;|&lt;|&gt;|&#39;|&apos;/g,
    (match) => entities[match as keyof typeof entities]
  );
}

// 将代码转换为图片
async function codeToImage(code: string, language: string): Promise<Buffer> {
  const editorConfig = vscode.workspace.getConfiguration("editor");

  // 使用 highlight.js 进行语法高亮
  const highlighted = hljs.highlight(code || "", { language });
  const html = highlighted.value;
  const lines = code.split("\n");

  // 计算画布大小
  const scale = 2; // 增加分辨率
  const fontSize = 14 * scale;
  const lineHeight = fontSize * 1.5;
  const padding = 24 * scale;
  const borderRadius = 12 * scale;

  // 设置最大宽度（以字符为单位）
  const maxCharsPerLine = 120;
  const charWidth = fontSize * 0.6; // 每个字符的估计宽度
  const maxContentWidth = maxCharsPerLine * charWidth;

  // 解析HTML并提取颜色信息
  const colorSpans: ColorSpan[][] = lines.map(() => []);
  let currentLine = 0;
  let currentPos = 0;

  const regex = /<span class="([\w-]+)">(.*?)<\/span>|([^<]+)/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const [, className, spanContent, plainText] = match;
    const text = decodeHTMLEntities(spanContent || plainText || "");

    // 处理换行
    const textLines = text.split("\n");
    textLines.forEach((lineText, index) => {
      if (index > 0) {
        currentLine++;
        currentPos = 0;
      }

      if (lineText && lineText.length > 0) {
        colorSpans[currentLine].push({
          text: lineText,
          color: className ? colorMap[className] || "#ABB2BF" : "#ABB2BF", // One Dark default text color
          start: currentPos,
        });
        currentPos += lineText.length;
      }
    });
  }

  // 创建临时画布来测量文本宽度
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");
  const fontFamily =
    String(editorConfig.get("fontFamily")) || 'JetBrains Mono, Consolas, "Courier New", monospace';
  measureCtx.font = `${fontSize}px ${fontFamily}`;

  // 处理行换行
  const wrappedLines: WrappedLine[] = [];
  colorSpans.forEach((spans) => {
    let currentWidth = 0;
    let currentSpans: ColorSpan[] = [];
    let isFirstLine = true;
    let indent = 0;

    // 计算缩进
    if (spans.length > 0) {
      const firstSpan = spans[0];
      if (firstSpan && firstSpan.text) {
        const match = firstSpan.text.match(/^\s+/);
        if (match) {
          indent = match[0].length;
        }
      }
    }

    spans.forEach((span) => {
      if (!span.text) return;

      const words = span.text.split(/(\s+)/);
      words.forEach((word) => {
        if (!word) return;

        const wordWidth = measureCtx.measureText(word).width;

        if (currentWidth + wordWidth > maxContentWidth) {
          // 添加当前行
          if (currentSpans.length > 0) {
            wrappedLines.push({ spans: currentSpans, indent: isFirstLine ? 0 : indent });
            // 开始新行
            currentSpans = [];
            currentWidth = indent * charWidth; // 添加缩进
            isFirstLine = false;
          }
        }

        currentSpans.push({
          text: word,
          color: span.color,
          start: currentWidth,
        });
        currentWidth += wordWidth;
      });
    });

    // 添加最后一行
    if (currentSpans.length > 0) {
      wrappedLines.push({ spans: currentSpans, indent: isFirstLine ? 0 : indent });
    }
  });

  // 计算实际需要的画布大小
  const width = maxContentWidth + padding * 2;
  const height = wrappedLines.length * lineHeight + padding * 2;

  // 创建最终画布
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // 启用字体平滑
  ctx.imageSmoothingEnabled = true;

  // 绘制背景
  ctx.fillStyle = "#282C34"; // One Dark background color
  ctx.beginPath();
  ctx.moveTo(borderRadius, 0);
  ctx.lineTo(width - borderRadius, 0);
  ctx.quadraticCurveTo(width, 0, width, borderRadius);
  ctx.lineTo(width, height - borderRadius);
  ctx.quadraticCurveTo(width, height, width - borderRadius, height);
  ctx.lineTo(borderRadius, height);
  ctx.quadraticCurveTo(0, height, 0, height - borderRadius);
  ctx.lineTo(0, borderRadius);
  ctx.quadraticCurveTo(0, 0, borderRadius, 0);
  ctx.fill();

  // 设置字体
  ctx.font = `${fontSize}px ${fontFamily}`;

  // 绘制代码
  wrappedLines.forEach((line, lineIndex) => {
    const y = padding + (lineIndex + 1) * lineHeight;
    let x = padding;

    // 添加缩进
    if (line.indent > 0) {
      x += line.indent * charWidth;
    }

    line.spans.forEach(({ text, color }) => {
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width;
    });
  });

  // 返回图片 Buffer
  return canvas.toBuffer("image/png");
}
