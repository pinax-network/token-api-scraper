// Import proto polyfill first to fix tronweb protobuf issues
import '../lib/proto-polyfill';
import { hextoString } from 'tronweb/utils';

export function parse_string(str: string) {
    const data = hextoString(str)
        .replace(/[\p{Cc}\p{Cf}]/gu, '') // remove all control & format chars
        .replace(/\\"/g, '"')
        .trim();

    return data.length ? data : undefined;
}
