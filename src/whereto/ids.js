export const cleanId = (raw) => (/^[a-z0-9]{8,16}$/.test(String(raw ?? '')) ? raw : null);
