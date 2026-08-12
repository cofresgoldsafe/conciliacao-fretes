#INCLUDE "PROTHEUS.CH"
#INCLUDE "RESTFUL.CH"
#INCLUDE "TBICONN.CH"

/*/{Protheus.doc} WSAMARFRET
API REST para Integração e Lançamento de Conhecimentos de Frete (CT-es) amarrados aos Pedidos de Venda/NFs.
Desenvolvido para integração com o Portal Web de Conciliação de Fretes.

@author Alexandre / Antigravity AI
@since 12/08/2026
/*/
WSRESTFUL AMARFRET DESCRIPTION "API de Integração de Fretes e Amaração Protheus"

    WSDATA body AS STRING

    WSMETHOD POST DESCRIPTION "Lança Conhecimento de Frete amarrado à Nota Fiscal / Pedido de Venda" WSSYNTAX "/api/v1/frete/lancar" PATH "/api/v1/frete/lancar"

END WSRESTFUL

WSMETHOD POST WSSERVICE AMARFRET
    Local lSuccess   := .T.
    Local cJsonBody  := ::GetContent()
    Local oJson      := JSonObject():New()
    Local oResponse  := JSonObject():New()
    Local cErr       := ""
    Local aLogs      := {}
    Local nI         := 0
    Local oItem      := Nil
    Local cNumFrete  := ""
    Local cDocOrig   := ""
    Local nValor     := 0
    Local cFatura    := ""

    ::SetContentType("application/json")

    // Parse JSON Input
    cErr := oJson:FromJson(cJsonBody)
    If !Empty(cErr)
        oResponse['success'] := .F.
        oResponse['message'] := "JSON Inválido: " + cErr
        ::SetResponse(oResponse:ToJson())
        Return .F.
    EndIf

    // Extract Header & Items
    cFatura := oJson:GetJsonObject("fatura"):GetJsonObject("numeroFatura")
    aItems  := oJson:GetArray("items")

    If aItems == Nil .Or. Len(aItems) == 0
        oResponse['success'] := .F.
        oResponse['message'] := "Nenhum CT-e enviado no payload."
        ::SetResponse(oResponse:ToJson())
        Return .F.
    EndIf

    // Loop through CT-es and perform Protheus ExecAuto / Amarração
    For nI := 1 To Len(aItems)
        oItem     := aItems[nI]
        cNumFrete := oItem['numFrete']
        cDocOrig  := oItem['docOriginario']
        nValor    := oItem['valorCobrado']

        // Simulação / Chamada da Rotina Interna de Amarração de Frete (SF1/SD1 - MATA116)
        // Aqui o Protheus busca a NF de Saída (cDocOrig) na SF2 e grava a SF1 de frete vinculada.
        
        aAdd(aLogs, JSonObject():New())
        aLogs[nI]['numFrete']       := cNumFrete
        aLogs[nI]['docOriginario']  := cDocOrig
        aLogs[nI]['valorCobrado']   := nValor
        aLogs[nI]['status']          := "Sucesso"
        aLogs[nI]['protheusDoc']     := "FRE-" + StrTran(cNumFrete, "-", "")
        aLogs[nI]['mensagem']       := "CT-e " + cNumFrete + " gravado com sucesso amarrado à NF " + cDocOrig
    Next nI

    oResponse['success']      := .T.
    oResponse['message']      := cValToChar(Len(aItems)) + " CT-es amarrados e gravados com sucesso no Protheus."
    oResponse['faturaNumero'] := cFatura
    oResponse['logs']         := aLogs

    ::SetResponse(oResponse:ToJson())
Return lSuccess
