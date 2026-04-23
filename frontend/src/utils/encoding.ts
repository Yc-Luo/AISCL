/**
 * 编码工具函数
 * 提供高性能的 Uint8Array 与 Base64 之间的互转
 */

/**
 * Uint8Array 转 Base64 字符串
 */
export function fromUint8Array(array: Uint8Array): string {
    // 使用比较高性能的分块处理方式，防止大数组导致栈溢出
    let binary = '';
    const len = array.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(array[i]);
    }
    return btoa(binary);
}

/**
 * Base64 字符串转 Uint8Array
 */
export function toUint8Array(base64String: string): Uint8Array {
    const binaryString = atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}
