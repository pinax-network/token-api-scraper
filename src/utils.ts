import { hextoString } from 'tronweb/utils';

export function parse_string(str: string) {
    const data = hextoString(str)
        .replace(/[\u0000-\u001F0-9]/g, '') // removes control chars and digits
        .replace(/\\"/g, '')
        .trim();
    if (data.length === 0) return undefined;
    return data;
}