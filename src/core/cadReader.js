// Leitura de DWG/DXF no Worker. A LibreDWG (WebAssembly, ~11 MB) só é baixada no primeiro DWG.
import wasmUrl from '../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url';
import {parseDXF, decodeDxfBytes} from './dxf.js';
import {normalizeLibreDwg, extractSources} from './cad.js';

let libredwg = null;
async function loadLibreDwg() {
  if (!libredwg) libredwg = (async () => {
    const {LibreDwg, createModule, Dwg_File_Type} = await import('@mlightcad/libredwg-web');
    const instance = await createModule({locateFile: () => wasmUrl});
    return {lib: LibreDwg.createByWasmInstance(instance), Dwg_File_Type};
  })().catch(e => { libredwg = null; throw e; });
  return libredwg;
}

const DWG_VERSIONS = {AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018'};

/**
 * @param {ArrayBuffer} bytes conteúdo do arquivo
 * @param {string} name nome do arquivo (define DWG ou DXF pela extensão/assinatura)
 * @returns {Promise<{format:string, sources:object[]}>}
 */
export async function readCadFile(bytes, name = '') {
  const head = new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, Math.min(6, bytes.byteLength)));
  const isDwg = /^AC\d{4}$/.test(head) || /\.dwg$/i.test(name);
  let model;
  if (isDwg) {
    const version = DWG_VERSIONS[head];
    if (!/^AC\d{4}$/.test(head)) throw Error('Este arquivo não é um DWG válido. Confira se o download terminou ou salve novamente no AutoCAD.');
    if (head < 'AC1012') throw Error(`DWG ${version || head} é antigo demais para leitura direta. Salve como DXF no AutoCAD e importe o DXF.`);
    let loaded;
    try { loaded = await loadLibreDwg(); } catch { throw Error('Não foi possível carregar o leitor de DWG. Verifique a conexão e tente de novo, ou importe o desenho salvo como DXF.'); }
    const {lib, Dwg_File_Type} = loaded;
    let ptr;
    try { ptr = lib.dwg_read_data(bytes, Dwg_File_Type.DWG); } catch { ptr = null; }
    if (!ptr) throw Error(`Não foi possível ler este DWG (${version ? 'AutoCAD ' + version : head}). Salve como DXF 2018 no AutoCAD e importe o DXF.`);
    try { model = normalizeLibreDwg(lib.convert(ptr)); }
    finally { try { lib.dwg_free(ptr); } catch { /* memória já liberada */ } }
    model.format = `DWG AutoCAD ${version || head}`;
  } else {
    const text = decodeDxfBytes(new Uint8Array(bytes));
    if (/^AutoCAD Binary DXF/.test(text)) throw Error('DXF binário não é suportado. Salve o desenho como DXF ASCII (texto).');
    model = parseDXF(text);
  }
  const sources = extractSources(model);
  if (!sources.length) throw Error('Nenhum ponto, linha ou face foi encontrado no desenho.');
  return {format: model.format, sources};
}
