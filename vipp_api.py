import sys
import json
import os
import urllib.request
import xml.etree.ElementTree as ET

"""
Módulo de Comunicação com a API WebService SOAP/REST da ViPP VisualSet
URL Oficial: https://vpsrv.visualset.com.br/vipp.asmx ou VippServico.asmx
"""

def consultar_vipp_etiqueta(etiqueta, usuario, token, id_perfil, contrato=""):
    """
    Consulta o WebService SOAP da ViPP VisualSet para obter os dados da postagem por Etiqueta/Registro.
    Retorna dicionário com NumeroNotaFiscal, PedidoVenda, Cliente, etc.
    """
    if not usuario or not token:
        return {
            "success": False,
            "error": "Token ou Usuário ViPP não informados."
        }

    # Envelope SOAP para chamada do método ObterPostagem / ListarRastreioObjeto no ViPP
    soap_body = f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ObterPostagem xmlns="http://www.visualset.com.br/">
      <PerfilVipp>
        <Usuario>{usuario}</Usuario>
        <Token>{token}</Token>
        <IdPerfil>{id_perfil}</IdPerfil>
      </PerfilVipp>
      <Etiqueta>{etiqueta}</Etiqueta>
    </ObterPostagem>
  </soap:Body>
</soap:Envelope>"""

    url = "https://vpsrv.visualset.com.br/vipp.asmx"
    headers = {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": "http://www.visualset.com.br/ObterPostagem"
    }

    try:
        req = urllib.request.Request(url, data=soap_body.encode('utf-8'), headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=10) as response:
            res_xml = response.read().decode('utf-8')
            root = ET.from_string(res_xml)
            
            # Extract NF and Order
            nf = ""
            pedido = ""
            cliente = ""
            
            for elem in root.iter():
                tag = elem.tag.split('}')[-1]
                if tag.lower() in ['notafiscal', 'numeronotafiscal', 'nf']:
                    nf = elem.text or ""
                elif tag.lower() in ['pedido', 'pedidovenda', 'obs1']:
                    pedido = elem.text or ""
                elif tag.lower() in ['destinatario', 'nome']:
                    cliente = elem.text or ""

            return {
                "success": True,
                "etiqueta": etiqueta,
                "notaFiscal": nf,
                "pedidoVenda": pedido,
                "cliente": cliente
            }
    except Exception as e:
        return {
            "success": False,
            "etiqueta": etiqueta,
            "error": str(e)
        }

def resolver_etiquetas_lote(etiquetas, config):
    """
    Recebe uma lista de etiquetas e tenta resolver cada uma via API ViPP.
    """
    usuario = config.get("usuario", "")
    token = config.get("token", "")
    id_perfil = config.get("idPerfil", "")
    contrato = config.get("contrato", "")

    resultados = {}
    for et in etiquetas:
        if usuario and token:
            res = consultar_vipp_etiqueta(et, usuario, token, id_perfil, contrato)
            if res.get("success"):
                resultados[et] = res
            else:
                resultados[et] = {"notaFiscal": "", "pedidoVenda": "", "error": res.get("error")}
        else:
            resultados[et] = {"notaFiscal": "", "pedidoVenda": "", "status": "Token ViPP Pendente"}

    return resultados

if __name__ == "__main__":
    # Test script standalone
    if len(sys.argv) > 1:
        etiquetas_input = sys.argv[1].split(',')
        cfg = {
            "usuario": os.environ.get("VIPP_USUARIO", ""),
            "token": os.environ.get("VIPP_TOKEN", ""),
            "idPerfil": os.environ.get("VIPP_ID_PERFIL", ""),
            "contrato": os.environ.get("VIPP_CONTRATO", "")
        }
        res = resolver_etiquetas_lote(etiquetas_input, cfg)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print(json.dumps({"status": "ViPP API Client Pronto", "uso": "python vipp_api.py ETIQUETA1,ETIQUETA2"}))
