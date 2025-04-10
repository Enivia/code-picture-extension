import * as vscode from "vscode";
import zhCN from "./zh-cn";
import enUS from "./en-us";

const messages: { [key: string]: any } = {
  "zh-cn": zhCN,
  "en-us": enUS,
};

export function getLocaleMessage() {
  // 获取 VS Code 的语言设置
  const locale = vscode.env.language.toLowerCase();
  // 如果没有对应的语言配置，默认使用英文
  return messages[locale] || messages["en-us"];
}

export type LocaleMessages = typeof zhCN;
