// structuredClone は Node 17+ / 主要ブラウザの標準グローバル（ECMAScript 標準ライブラリ外）。
// lib に DOM/Node を含めずに型だけ補う。
declare function structuredClone<T>(value: T): T;
