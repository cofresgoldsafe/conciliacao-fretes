import ftplib
import io
import os
import sys
import json
import csv
import re
from datetime import datetime

# Configurações FTP ViPP (Suporte a Env Vars com Fallbacks Oficiais)
FTP_HOST = os.environ.get('VIPP_FTP_HOST', 'vipp.visualset.com.br')
FTP_PORT = int(os.environ.get('VIPP_FTP_PORT', '21'))
FTP_USER = os.environ.get('VIPP_FTP_USER', 'vipp_003070')
FTP_PASS = os.environ.get('VIPP_FTP_PASS', '123456vs')
FTP_DIR = os.environ.get('VIPP_FTP_DIR', '/Retorno')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data', 'vipp_retorno')

def ensure_data_dir():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)

def download_ftp_files():
    ensure_data_dir()
    downloaded_files = []
    
    ftp = ftplib.FTP()
    ftp.connect(FTP_HOST, FTP_PORT, timeout=15)
    ftp.login(FTP_USER, FTP_PASS)
    ftp.set_pasv(True)
    
    try:
        ftp.cwd(FTP_DIR)
        remote_files = ftp.nlst()
        
        for fname in remote_files:
            if fname.upper().endswith('.CSV'):
                local_path = os.path.join(DATA_DIR, fname)
                with open(local_path, 'wb') as f:
                    ftp.retrbinary('RETR ' + fname, f.write)
                downloaded_files.append(fname)
    finally:
        try:
            ftp.quit()
        except:
            pass
            
    return downloaded_files

def parse_all_csv_files():
    ensure_data_dir()
    csv_files = [f for f in os.listdir(DATA_DIR) if f.upper().endswith('.CSV')]
    
    postings_by_etiqueta = {}
    postings_list = []
    
    for fname in sorted(csv_files):
        fpath = os.path.join(DATA_DIR, fname)
        content = ''
        try:
            with open(fpath, 'r', encoding='utf-8-sig', errors='replace') as f:
                content = f.read()
        except:
            with open(fpath, 'r', encoding='latin-1', errors='replace') as f:
                content = f.read()
                
        lines = [l for l in content.splitlines() if l.strip()]
        if not lines:
            continue
            
        reader = csv.reader(lines, delimiter=';')
        rows = list(reader)
        if len(rows) <= 1:
            continue
            
        header = rows[0]
        
        for r_idx, row in enumerate(rows, 1):
            if len(row) < 11:
                continue
                
            etiqueta = row[10].strip().upper() if len(row) > 10 else ''
            if not etiqueta or not re.match(r'^[A-Z]{2}\d{9}[A-Z]{2}$', etiqueta):
                continue
                
            data_postagem = row[0].strip() if len(row) > 0 else ''
            servico_cod = row[9].strip() if len(row) > 9 else ''
            doc_fiscal = row[21].strip() if len(row) > 21 else ''
            col_y = row[24].strip() if len(row) > 24 else ''
            chave_nfe = row[25].strip() if len(row) > 25 else ''
            destinatario = row[52].strip() if len(row) > 52 else ''
            obs_livre = row[53].strip() if len(row) > 53 else ''
            cidade = row[58].strip() if len(row) > 58 else ''
            uf = row[59].strip() if len(row) > 59 else ''
            cep = row[60].strip() if len(row) > 60 else ''
            
            # Valor postagem
            valor_postagem = 0.0
            if len(row) > 14 and row[14].strip():
                try:
                    valor_postagem = float(row[14].strip().replace('.', '').replace(',', '.'))
                except:
                    pass
            
            # Mapeamento do Serviço
            servico_nome = 'CORREIOS'
            if servico_cod == '3220' or '03220' in servico_cod:
                servico_nome = 'SEDEX (03220)'
            elif servico_cod == '3298' or '03298' in servico_cod:
                servico_nome = 'PAC (03298)'
            elif servico_cod == '3301' or '03301' in servico_cod:
                servico_nome = 'PAC REVERSO (03301)'
                
            # Classificação: OS vs NF
            # Regra: se Col Y contiver "OS 1234", é Ordem de Serviço. Caso contrário, é NF.
            os_match = re.search(r'\bOS\s*(\d+)', col_y, re.IGNORECASE)
            
            if os_match:
                tipo_doc = 'OS'
                os_num = os_match.group(1)
                identificador = f"OS {os_num}"
                doc_originario = f"OS {os_num}"
                nf_num = ''
                nf_aux_match = re.search(r'\bNF\s*(\d+)', col_y, re.IGNORECASE)
                if nf_aux_match:
                    nf_num = nf_aux_match.group(1)
                elif doc_fiscal.isdigit():
                    nf_num = doc_fiscal
            else:
                tipo_doc = 'NF'
                os_num = ''
                nf_match = re.search(r'\bNF\s*(\d+)', col_y, re.IGNORECASE)
                if nf_match:
                    nf_num = nf_match.group(1)
                elif doc_fiscal.isdigit():
                    nf_num = doc_fiscal
                elif re.search(r'\d+', doc_fiscal):
                    nf_num = re.search(r'\d+', doc_fiscal).group(0)
                else:
                    nf_num = ''
                identificador = nf_num if nf_num else 'Sem Info'
                doc_originario = nf_num if nf_num else 'Sem Info'
                
            posting_data = {
                'etiqueta': etiqueta,
                'dataPostagem': data_postagem,
                'servicoCod': servico_cod,
                'servico': servico_nome,
                'valorPostagem': valor_postagem,
                'tipoDoc': tipo_doc,
                'identificador': identificador,
                'docOriginario': doc_originario,
                'osNum': os_num,
                'nfNum': nf_num,
                'chaveNfe': chave_nfe,
                'destinatario': destinatario,
                'obsLivre': obs_livre,
                'cidade': cidade,
                'uf': uf,
                'cep': cep,
                'arquivoOrigem': fname,
                'colYRaw': col_y
            }
            
            postings_by_etiqueta[etiqueta] = posting_data
            postings_list.append(posting_data)
            
    return {
        'files': csv_files,
        'count': len(postings_list),
        'uniqueEtiquetas': len(postings_by_etiqueta),
        'byEtiqueta': postings_by_etiqueta,
        'list': postings_list
    }

def main():
    sync = '--sync' in sys.argv or '-s' in sys.argv
    res = {}
    
    try:
        downloaded = []
        if sync or not os.path.exists(DATA_DIR) or not os.listdir(DATA_DIR):
            downloaded = download_ftp_files()
            
        parsed = parse_all_csv_files()
        
        res = {
            'success': True,
            'downloaded': downloaded,
            'files': parsed['files'],
            'totalPostagens': parsed['count'],
            'totalEtiquetas': parsed['uniqueEtiquetas'],
            'byEtiqueta': parsed['byEtiqueta'],
            'list': parsed['list']
        }
    except Exception as e:
        try:
            parsed = parse_all_csv_files()
            res = {
                'success': True,
                'fromCache': True,
                'warning': f'Falha na conexão FTP, dados carregados do cache local: {str(e)}',
                'files': parsed['files'],
                'totalPostagens': parsed['count'],
                'totalEtiquetas': parsed['uniqueEtiquetas'],
                'byEtiqueta': parsed['byEtiqueta'],
                'list': parsed['list']
            }
        except Exception as cache_err:
            res = {
                'success': False,
                'error': f'Erro ao processar ViPP FTP: {str(e)} | Cache: {str(cache_err)}'
            }
            
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False))

if __name__ == '__main__':
    main()
