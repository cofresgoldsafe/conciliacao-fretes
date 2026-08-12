#INCLUDE "protheus.ch"
#Include "RwMake.CH"
#INCLUDE "TBICONN.CH"
#include "topconn.ch"

#DEFINE ROTINA 		01 // Define a Rotina : 1-Inclusao / 2-Exclusao
#DEFINE TIPONF		02 // Considerar Notas : 1 - Compra , 2 - Devolucao
#DEFINE DATAINI		03 // Data Inicial para Filtro das NF Originais
#DEFINE DATAATE		04 // Data Final para Filtro das NF originais
#DEFINE FORNORI		05 // Cod. Fornecedor para Filtro das NF Originais
#DEFINE LOJAORI		06 // Loja Fornecedor para Fltro das NF Originais
#DEFINE FORMUL		07 // Utiliza Formulario proprio ? 1-Sim,2-Nao
#DEFINE NUMNF		08 // Num. da NF de Conhecimento de Frete
#DEFINE SERNF		09 // Serie da NF de COnhecimento de Frete
#DEFINE FORNECE		10 // Codigo do Fornecedor da NF de FRETE
#DEFINE LOJA		11 // Loja do Fornecedor da NF de Frete
#DEFINE TES			12 // Tes utilizada na Classificacao da NF
#DEFINE VALOR		13 // Valor total do Frete sem Impostos
#DEFINE UFORIGEM	14 // Estado de Origem do Frete
#DEFINE AGLUTINA	15 // Aglutina Produtos : .T. , .F.
#DEFINE BSICMRET	16 // Base do Icms Retido
#DEFINE VLICMRET	17 // Valor do Icms Retido
#DEFINE FILTRONF    18 // Filtra nota com conhecimento frete .F. , .T.

/*/
ÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜÜ
±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±±
±±ÚÄÄÄÄÄÄÄÄÄÄÂÄÄÄÄÄÄÄÄÄÄÂÄÄÄÄÄÄÄÂÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÂÄÄÄÄÄÄÂÄÄÄÄÄÄÄÄÄÄ¿±±
±±³Fun‡…o    ³ AmarFret ³ Autor ³ Ricardo Carvalho       ³ Data ³05.02.2013³±±
±±ÃÄÄÄÄÄÄÄÄÄÄÅÄÄÄÄÄÄÄÄÄÄÁÄÄÄÄÄÄÄÁÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÁÄÄÄÄÄÄÁÄÄÄÄÄÄÄÄÄÄ´±±
±±³Descri‡…o ³ Programa de Digitacao de Conhecimento de Frete              ³±±
ßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßßß
/*/
/*
==============================================================================================================================================================
ALTERAÇÕES:

(07/10/2014-José Antonio/Erpworks) Alterado o código do produto para a filial 04 (090012120000005)

(06/02/2015-José Antonio/Erpworks) Incluido validação nos campos para não aceitar apóstrofo.      

(23/02/2015-Wellyngton P. Sanches/Erpworks) Alterações nos campos D1_COD, D1_GRUPO, D1_DESCR, D1_STSERV, F1_TIPO   

(24/02/2015-Wellyngton P. Sanches/Erpworks)Alteração para que a data de vencimento seja calculada conforme a forma de pagamento   

(03/03/2015-Wellyngton P. Sanches/Erpworks) F1_PREFIXO := aParametros[09]	- solictação do Alexandre para amarrar o documento de entrada com o contas a pagar        

(20/03/2015-Wellyngton P. Sanches/Erpworks) Foi removido esse calculo para a data de vencimento porque o Alexandre solicitou no dia 17/03/2015 que a dt de vencimento fosse a mesma que eles digitavam e não mais calculado pela forma de pagamento.	   

==============================================================================================================================================================
*/
User Function AmarFret()

LOCAL cFiltraSF1 := ""
LOCAL cQrySF1    := ""
//LOCAL cRetPE 	 := ""
LOCAL lContinua  := .T.
//Local lrot := .T.

Private aIndexSF1	 := {}

Private bFiltraBrw  := {|| Nil}
Private cCadastro   := "Nota Fiscal de Conhecimento de Frete"
Private aRotina := { 	{ "Pesquisar","PesqBrw",		0,1},;
{ "Visualizar","A103NFiscal",	0,2} }
Private INCLUI      := .F.
Private ALTERA      := .F.
Private aBackSDE    := {}
Private aParametros := {}
Private lExc := .T.

If !cTelaBen(@aParametros)
	lContinua := .F.
EndIf

If lContinua
	dDataIni	   := aParametros[DATAINI]
	dDataFim	   := aParametros[DATAATE]
	nRotina        := aParametros[ROTINA]
	cFornOri	   := aParametros[FORNORI]
	cLojaOri	   := aParametros[LOJAORI]
	nTipoOri	   := aParametros[TIPONF]
	lAglutProd     := aParametros[AGLUTINA]
	cUFOri		   := aParametros[UFORIGEM]
	lFiltroNF      := aParametros[FILTRONF]
	
	If nRotina == 1
		aadd(aRotina, {"Gera Conhec.","U_BENEInclui"		,0,3})
		lExc := .F.
	Else
		aadd(aRotina, {"Excluir","U_BENEInclui"	,0,5})
		lExc := .T.
	EndIF
	
	dbSelectArea("SF2")
	dbSetOrder(1)
	cFiltraSF1	:= 'F2_FILIAL=="'+xFilial("SF2")+'".And.'
	cQrySF1     := "F2_FILIAL='"+xFilial("SF2")+"' AND "
	If !Empty(cFornOri).And.!Empty(cLojaOri)
		cFiltraSF1	+= ' F2_CLIENTE=="'+cFornOri+'".And.F2_LOJA=="'+cLojaOri+'" .And. '
		cQrySF1     += " F2_CLIENTE='"+cFornOri+"' AND F2_LOJA = '"+cLojaOri+"' AND "
	Endif
	cFiltraSF1 += 'DTOS(F2_EMISSAO)>="'+DTOS(dDataIni)+'".And.DTOS(F2_EMISSAO)<="'+DTOS(dDataFim)+'" '
	cQrySF1    += "F2_EMISSAO>='"+DTOS(dDataIni)+"' AND F2_EMISSAO <= '"+DTOS(dDataFim)+"' "
	
	bFiltraBrw 	:= {|x| IIf(x==Nil,FilBrowse("SF2",@aIndexSF1,@cFiltraSF1),cQrySF1)}
	
	If !InTransact()
		Eval(bFiltraBrw)
	EndIf
	
	dbSelectArea("SF2")
	
	MarkBrow("SF2","F2_OK","")
		
	If !Intransact()
		//EndFilBrw("SF2",aIndexSF1)
		RetIndex("SF2")
	EndIf
	
	SF2->(dbSetOrder(1))
	
EndIF

Return .T.
/*
==============================================================================================================================================================
FUNÇÃO: CTELABEN
==============================================================================================================================================================
*/
Static Function cTelaBen(aParametros)

Local aCombo1	    := {"Amarrar NF de Conhec. Frete","Desamarrar NF de Conhec. Frete"}
//Local aCombo2	    := {"NF de Saída","NF de Saída"} 
Local aCombo2	    := {"NF de Saída", "NF de Saida TP B"}
Local aCombo3	    := {"Não","Sim"}
Local aCombo4	    := {"Sim","Não"}
Local aCombo5	    := {"Não","Sim"}
Local aCliFor	    := {{"Cliente","SA1"},{"Fornecedor","SA2A"}}
Local nCombo1	    := 1
Local nCombo2	    := 1
Local nCombo4	    := 1
Local nCombo5	    := 1
Local n116Valor	    := 0
Local n116BsIcmret	:= 0
Local cCond	:= CriaVar("E4_CODIGO",.F.)
Local d116DataDe    := dDataBase - 90
Local d116DataAte   := dDataBase

Local c116Combo1    := aCombo1[nCombo1]
Local c116Combo2    := aCombo2[1]
Local c116Combo3    := aCombo3[1]
Local c116Combo4	:= aCombo4[1]
Local c116Combo5    := aCombo5[1]
Local lRet		    := .F.

Local oDlg
Local oCombo1
Local oCombo2
Local oCombo3
Local oCombo4
Local oCombo5
Local oCliFor
Local oFornOri

Private d116UFOri	:= Date()
Private aValidGet	:= {}
Private l6Auto := .F.
Private nCombo3	    := If(l6Auto,aAutoCab[10,2],1)

Private c116FornOri   := If(l6Auto,aAutoCab[4,2],CriaVar("F2_CLIENTE",.F.))
Private c116LojaOri   := If(l6Auto,aAutoCab[5,2],CriaVar("F2_LOJA",.F.))
Private c116NumNF	    := If(l6Auto,aAutoCab[11,2],CriaVar("F2_DOC",.F.))
Private c116SerNF	    := If(l6Auto,aAutoCab[12,2],CriaVar("F2_SERIE",.F.))
Private c116Fornece   := If(l6Auto,aAutoCab[13,2],CriaVar("F2_CLIENTE",.F.))
Private c116Loja	    := If(l6Auto,aAutoCab[14,2],CriaVar("F2_LOJA",.F.))
Private c116Tes	    := If(l6Auto,aAutoCab[15,2],CriaVar("D2_TES",.F.))

DEFINE MSDIALOG oDlg FROM 87 ,52  TO 450,609 TITLE "Parametros "+cCadastro Of oMainWnd PIXEL
@ 22 ,3   TO 68 ,274 LABEL "Parametros do Filtro" OF oDlg PIXEL
@ 6 ,48  MSCOMBOBOX oCombo1 VAR c116Combo1 ITEMS aCombo1 SIZE 83 ,50 OF oDlg PIXEL VALID (nCombo1:=aScan(aCombo1,c116Combo1))
@ 7  ,6   SAY "Quanto a Nota" Of oDlg PIXEL SIZE 43,09
@ 7  ,140 SAY "Filtrar notas com conhecimento de frete" Of oDlg PIXEL SIZE 100 ,9
@ 7  ,245 MSCOMBOBOX oCombo5 VAR c116Combo5 ITEMS aCombo5 SIZE 30 ,50 OF oDlg PIXEL When (nCombo1==1) VALID (nCombo5:=aScan(aCombo5,c116Combo5))
@ 34 ,12  SAY "Data Inicial" Of oDlg PIXEL SIZE 60 ,9
@ 34 ,145 SAY "Data Final" Of oDlg PIXEL SIZE 59 ,9
@ 33 ,48  MSGET d116DataDe  Valid !Empty(d116DataDe) OF oDlg PIXEL SIZE 60 ,9
@ 33 ,185 MSGET d116DataAte Valid !Empty(d116DataAte) OF oDlg PIXEL SIZE 60 ,9
@ 52  ,12 SAY "Considerar" Of oDlg PIXEL SIZE 54 ,9
@ 51  ,48 MSCOMBOBOX oCombo2 VAR c116Combo2 ITEMS aCombo2 SIZE 60 ,50;
 OF oDlg PIXEL When (nCombo1==1) VALID ((nCombo2:=aScan(aCombo2,c116Combo2)),oCliFor:Refresh(),oFornOri:cF3:=aCliFor[nCombo2][2],c116FornOri:=SPACE(Len(c116FornOri)),c116LojaOri:=SPACE(Len(c116LojaOri)))

@ 52 ,145  SAY oCliFor VAR aCliFor[nCombo2][1] Of oDlg PIXEL SIZE 28 ,9
@ 51 ,185  MSGET oFornOri VAR c116FornOri Picture "999999" F3 aCliFor[nCombo2][2];
OF oDlg PIXEL SIZE 40 ,9 VALID !Empty(c116FornOri)  

@ 51 ,230  MSGET c116LojaOri Picture "99"; // F3 CpoRetF3("A1_LOJA");
OF oDlg PIXEL SIZE 17 ,9  When .F. VALID !Empty(c116LojaOri)   

@ 74 ,3   TO 160,274 LABEL "Dados da NF de Frete" OF oDlg PIXEL
@ 86 ,10  SAY "Form. Proprio" Of oDlg PIXEL SIZE 32 ,9 COLOR CLR_HBLUE,oDlg:nClrPane
@ 85 ,47  MSCOMBOBOX oCombo3 VAR c116Combo3 ITEMS aCombo3 SIZE 35 ,50 OF oDlg PIXEL When (nCombo1==1) VALID ((nCombo3:=aScan(aCombo3,c116Combo3)),c116NumNF:=SPACE(Len(c116NumNF)),c116SerNF:=SPACE(Len(c116SerNF)))
@ 86 ,145 SAY "Num. Conhec." Of oDlg PIXEL SIZE 39 ,9 COLOR CLR_HBLUE,oDlg:nClrPane
@ 85 ,185 MSGET c116NumNF Picture "999999999" OF oDlg PIXEL SIZE 31 ,9 When (nCombo1==1.And.nCombo3==1) VALID A116ChkNFE(nCombo3,c116Fornece,c116Loja,c116NumNF,c116SerNF)
@ 86 ,225 SAY "Serie" Of oDlg PIXEL SIZE 15 ,9
@ 85 ,242 MSGET c116SerNF Picture PesqPict("SF1","F1_SERIE") OF oDlg PIXEL SIZE 19 ,9  When (nCombo1==1.And.nCombo3==1) VALID A116ChkNFE(nCombo3,c116Fornece,c116Loja,c116NumNF,c116SerNF)

@ 105,10  SAY "Fornecedor" Of oDlg PIXEL SIZE 47 ,9 COLOR CLR_HBLUE,oDlg:nClrPane
@ 104,47  MSGET c116Fornece Picture "999999" F3 "SA2A" ;
OF oDlg PIXEL SIZE 40 ,9 When (nCombo1==1) VALID !Empty(c116Fornece)

@ 104,88  MSGET c116Loja Picture "99"; //F3 "SA22"  ;  //CpoRetF3("A2_LOJA");
OF oDlg PIXEL SIZE 19 ,9 When .F. VALID !Empty(c116Loja)

@ 105,114 SAY "Cod. TES" Of oDlg PIXEL SIZE 32 ,9 COLOR CLR_HBLUE,oDlg:nClrPane
@ 104,140 MSGET c116TES Picture PesqPict("SD1","D1_TES") F3 CpoRetF3("D2_TES");
OF oDlg PIXEL SIZE 25 ,9 When (nCombo1==1) VALID  (Empty(c116Tes) .Or. ExistCpo("SF4",c116Tes)) //.And. A116ChkTES(c116TES)

@ 105,175 SAY " Valor" Of oDlg PIXEL SIZE 33 ,9 COLOR CLR_HBLUE,oDlg:nClrPane
@ 104,203 MSGET n116Valor Picture PesqPict("SD1","D1_TOTAL") ;
OF oDlg PIXEL SIZE 61 ,9 When (nCombo1==1)

@ 125,10  SAY "Dt Venc" Of oDlg PIXEL SIZE 36 ,9
@ 124 ,47  MSGET d116UfOri  Valid !Empty(d116DataDe) OF oDlg PIXEL SIZE 25 ,9
@ 125,120 SAY "Aglutina Produtos ?" Of oDlg PIXEL SIZE 48 ,9
@ 125,180 MSCOMBOBOX oCombo4 VAR c116Combo4 ITEMS aCombo4 SIZE 30 ,50 OF oDlg PIXEL When (nCombo1==1) VALID (nCombo4:=aScan(aCombo4,c116Combo4))

@ 146,10  SAY "Aliq Icms" Of oDlg PIXEL SIZE 49 ,9
@ 144,47  MSGET oGetBs VAR n116BsIcmRet Picture PesqPict("SD2","D2_ALQIMP1") F3 CpoRetF3("D2_ALQIMP1");
OF oDlg PIXEL SIZE 70 ,9 When (nCombo1==1) VALID Positivo(n116BsIcmRet)

@ 144,140 SAY "Cond. Pgto" Of oDlg PIXEL SIZE 41 ,9
@ 143,180 MSGET cCond Picture PesqPict("SE4","E4_CODIGO") F3 "SE4" OF oDlg PIXEL SIZE 70 ,9 When (nCombo1==1) //VALID Positivo(n116VlrIcmRet)
@168,220 BUTTON "Confirma >>" SIZE 35 ,10  FONT oDlg:oFont ACTION If(A116StpOk(c116NumNF,c116Fornece,c116Loja,c116Tes,c116FornOri,c116LojaOri,nCombo1,n116Valor,cCond),(lRet:=.T.,oDlg:End()),Nil)  OF oDlg PIXEL
@168,180 BUTTON "<< Cancelar" SIZE 35 ,10  FONT oDlg:oFont ACTION (oDlg:End())  OF oDlg PIXEL

ACTIVATE MSDIALOG oDlg CENTERED

nCombo1:= If(nCombo1==1,1,2)

aParametros:= {	nCombo1,; // 1 Define a Rotina : 1-Inclusao / 2-Exclusao
nCombo2,; // 2 Considerar Notas : 1 - Compra , 2 - Devolucao
d116DataDe,; // 3 Data Inicial para Filtro das NF Originais
d116DataAte,;// 4 Data Final para Filtro das NF originais
c116FornOri,;// 5 Cod. Fornecedor para Filtro das NF Originais
c116LojaOri,;// 6 Loja Fornecedor para Fltro das NF Originais
nCombo3,; // 7 Utiliza Formulario proprio ? 1-Sim,2-Nao
c116NumNF,;  // 8 Num. da NF de Conhecimento de Frete
c116SerNF,;  // 9 Serie da NF de COnhecimento de Frete
c116Fornece,;// 10 Codigo do Fornecedor da NF de FRETE
c116Loja,;   // 11 Loja do Fornecedor da NF de Frete
c116Tes,;    // 12 Tes utilizada na Classificacao da NF
n116Valor,;  // 13 Valor total do Frete sem Impostos
d116UFOri,;  // 14 Estado de Origem do Frete
(nCombo4==1),; // 15 Aglutina Produtos : .T. , .F.
n116BsIcmRet,;//16 Base do Icms Retido
cCond,;//Duplicata
(nCombo5==2);  //18 Filtra nota com conhecimento frete .F. , .T.
}

Return lRet
/*
==============================================================================================================================================================
FUNÇÃO: A116STPOK
==============================================================================================================================================================
*/
Static Function A116StpOk(cNumNF,cFornece,cLoja,cTes,cFornOri,cLojaOri,nCombo1,nValor,cCond)

Local lRet := .T.

If nCombo1 == 1
	If (Empty(cNumNF).And.nCombo3==1) .Or. Empty(cFornece) .Or. Empty(cLoja) .Or. Empty(cTes) .Or. Empty(nValor) .Or. Empty(cCond)
		Aviso("Atencao!","Existem campos de preenchimento obrigatorio que nao foram informados. Verifique os campos da tela de que contem os dados da nota fiscal.",{"Voltar"},2)
		lRet := .F.
	EndIf
EndIf

If lRet .And. (!Empty(cFornOri).And.Empty(cLojaOri))
	Aviso("Atencao!","Codigo da loja do fornecedor invalida. Verifique o preenchimento correto da loja do Fornecedor nos parametros para filtragem da nota fiscal.",{"Voltar"},2)
	lRet := .F.
EndIf

Return lRet
/*
==============================================================================================================================================================
FUNÇÃO: BENETGRAVA
==============================================================================================================================================================
*/
User Function BENETGrava(aDados)

Local aArea	    := GetArea()
Local nX        := 0

If lExc
	
	For nX := 1 to Len(aDados)
		
		dbSelectArea("SF2")
		dbSetOrder(2)
		DbSeek(xFilial("SF2")+aDados[nX][3]+aDados[nX][4]+aDados[nX][1]+aDados[nX][2])
		RecLock("SF2",.F.)
		SF2->F2_NFRETE := aParametros[8]
		SF2->F2_NFRETE := aParametros[8]
		SF2->F2_NFRETE := aParametros[8]
		MsUnlock()
	Next nX
	
Else
	
	For nX := 1 to Len(aDados)
		dbSelectArea("SF2")
		dbSetOrder(2)
		DbSeek(xFilial("SF2")+aDados[nX][3]+aDados[nX][4]+aDados[nX][1]+aDados[nX][2])
		RecLock("SF2",.F.)
		dbDelete()
		MsUnlock()
	Next
	
	
EndIf
RestArea(aArea)

Return()
/*
==============================================================================================================================================================
FUNÇÃO: VALIDEN
==============================================================================================================================================================
*/
Static Function Validen(cNumNF,cFornece,cLoja,cTes,cFornOri,cLojaOri,nCombo1,nValor,nCombo3)
Local lRet := .T.

If nCombo1 == 1
	If (Empty(cNumNF).And.nCombo3==1) .Or. Empty(cFornece) .Or. Empty(cLoja) .Or. Empty(cTes) .Or. Empty(nValor)
		Aviso("Atencao!","Existem campos de preenchimento obrigatorio que nao foram informados. Verifique os campos da tela de que contem os dados da nota fiscal.",{"Voltar"},2)
		lRet := .F.
	EndIf
EndIf

If lRet .And. (!Empty(cFornOri).And.Empty(cLojaOri))
	Aviso("Atencao!","Codigo da loja do fornecedor invalida. Verifique o preenchimento correto da loja do Fornecedor nos parametros para filtragem da nota fiscal.",{"Voltar"},2)
	lRet := .F.
EndIf

Return lRet
/*
==============================================================================================================================================================
FUNÇÃO: BENEINCLUI
==============================================================================================================================================================
*/
User Function BENEInclui(cAlias,cCampo,nOpcX,cMarca,lInverte)

//Local aValores	 := {0,0,0,0,0,0,0,0,0}
//Local aTitles	 := {"Totais",;
//"Inf. Fornecedor/Cliente",;
//"Descontos/Frete/Despesas",;
//"Livros Fiscais",;
//"Impostos","Duplicatas"}

//Local aFldCBAtu  := Array(Len(aTitles))
//Local aSizeAut	 := MsAdvSize(,.F.,400)
//Local cCadastro	 := "Nota Fiscal de Conhecimento de Frete"
//Local cArquivo 	 := ""
Local cAliasSF2  := "SF2"
Local cAliasSD2  := "SD2"
//Local cAliaAKD2 := ""
Local cNum := "" //aParametros[8]
Local cSer := ""
Local cEst := ""
Local cFor := ""
Local cLoja := ""      
//Local nDiasCondPg := 0  
//Local cDiasCondPg := ""
//Local lNext := .T. 
Local dDatavenc := date() 


Local cOrder3 := "%"

Private aDados := {}
Private aItensD1 := {}
Private aCab := {}
Private lMsErroAuto := .F.
Private lMsHelpAuto := .F.

cOrder3 += "2"
cOrder3 += "%"
cMarca   := ThisMark()
lInverte := ThisInv()

cAliasSF2 := "A116INCL"
cAliasSD2 := cAliasSF2

dbSelectArea("SF2")
dbSetOrder(1)
Eval(bFiltraBrw)
MsSeek(xFilial("SF2"))

//cEst := Posicione("SA4",01,"  "+aParametros[10]+aParametros[11],"A4_EST")  
cEst := Posicione("SA2",01,"  "+aParametros[10]+aParametros[11],"A2_EST")      
cLoja := aParametros[11] // Posicione("SA2",01,"  "+aParametros[10],"A2_LOJA") //aParametros[11]

While !Eof() .And. xFilial("SF2") == SF2->F2_FILIAL
	
	If IsMark("F2_OK",cMarca,lInverte)
		
		If SF2->F2_OK == cMarca
			
			If nRotina == 1   
	   /*		     
	   
	  Alterado pelo Wellyngton - ErpWorks 20/03/2015 Foi removido esse calculo para a data de vencimento porque o Alexandre solicitou no dia 17/03/2015 que a dt de vencimento fosse a mesma que eles digitavam e não mais calculado pela forma de pagamento.
	   
dbSelectArea("SE4")  	//Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.
dbSetOrder(1)         	//Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.
MsSeek(xFilial("SE4")) 	 //Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.
cDiasCondPg := Posicione("SE4",01,"  "+aParametros[17],"E4_COND") //Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.
nDiasCondPg   := val(cDiasCondPg)  //Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.
dDatavenc :=DaySum( aParametros[14] , nDiasCondPg )  //Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.			 			
                  */
dDatavenc := aParametros[14]    // Alterado pelo Wellyngton - ErpWorks 20/03/2015 - Foi removido esse calculo para a data de vencimento porque o Alexandre solicitou no dia 17/03/2015 que a dt de vencimento fosse a mesma que eles digitavam e não mais calculado pela forma de pagamento.				
				RecLock("SF2",.F.)
				
				SF2->F2_COFRETE := aParametros[8]
				SF2->F2_SERFRET := aParametros[9]
				SF2->F2_VALFRET := aParametros[13]
				SF2->F2_COFOR := aParametros[10]
				SF2->F2_COLOJ := aParametros[11]
				
				MsUnlock()
				
				DbSelectArea("SD1")
				RecLock("SD1",.T.)
				D1_ITEM := "0001"
				D1_UM := "UN"
			   //	D1_COD := Iif(SM0->M0_CODIGO=="04","090012120000005","010020205000003") Alterado pelo Wellyngton - ErpWorks 13/02/2015 solictação do Alexandre
			   	D1_COD := "090010B00000001"  //"090012120000005"
				D1_QUANT := 0
				D1_VUNIT :=  aParametros[13]
				D1_EMISSAO := DATE()
				D1_DTDIGIT := DATE()
				D1_FILIAL := "01"
				D1_LOCAL := "01"
				// D1_TIPO := "C"   Alterado pelo Wellyngton - ErpWorks 23/02/2015 solictação do Alexandre para tirar a nota tipo complemento e colocar como Normal
				D1_TIPO := "N"
				D1_FORNECE := aParametros[10]
				D1_LOJA := cLoja
				D1_BASEICM := aParametros[13]
				D1_CUSTO := aParametros[13]
				D1_PICM := aParametros[16]
				D1_VALICM := (D1_PICM*aParametros[13])/100
				D1_CF := "2353"
				
				D1_TOTAL := aParametros[13]
				D1_TES := aParametros[12]
				D1_DOC := aParametros[08]
				D1_SERIE := aParametros[09]
				D1_CLASFIS := "000"
				D1_GRUPO := "090"      // Alterado pelo Wellyngton - ErpWorks 13/02/2015 solictação do Alexandre
				D1_DESCR := "DESP FRETE" // Alterado pelo Wellyngton - ErpWorks 13/02/2015 solictação do Alexandre
				D1_STSERV := "1" // Alterado pelo Wellyngton - ErpWorks 13/02/2015 solictação do Alexandre
				
				Msunlock()
				
				DbSelectArea("SF1")
				RecLock("SF1",.T.)
				
				F1_DOC := aParametros[08]
				F1_SERIE := aParametros[09]
				F1_DUPL := aParametros[08]
				F1_FORNECE := aParametros[10]
				F1_LOJA := cLoja
				F1_COND := aParametros[17]
				F1_EMISSAO := DATE()
				F1_EST := cEst   
					// F1_TIPO := "C"   Alterado pelo Wellyngton - ErpWorks 23/02/2015 solictação do Alexandre para tirar a nota tipo complemento e colocar como Normal
				F1_TIPO := "N"
				F1_FORMUL := "N"
				F1_ESPECIE :="CTR"
				F1_BASEICM := aParametros[13]
				F1_VALICM := (aParametros[16]*aParametros[13])/100
				F1_FILIAL := "01"
				F1_VALMERC := aParametros[13]
				F1_VALBRUT := aParametros[13]
				F1_DTDIGIT := DATE()
				F1_ESPECIE := "CTR"
				F1_MOEDA := 1
				F1_STATUS := "A"
			    // F1_PREFIXO := aParametros[09]	Alterado pelo Wellyngton - ErpWorks 03/03/2015 solictação do Alexandre para amarrar o documento de entrada com o contas a pagar
				F1_PREFIXO := "FRE"
				F1_RECBMTO := DATE()
				
				Msunlock()
				
				MsgInfo("Nota fiscal 'CTR' N: '"+aParametros[08]+"' GERADA COM SUCESSO")
				
				
				DbSelectArea("SE2")
				RecLock("SE2",.T.)
				SE2->E2_FILIAL  := "01"
				SE2->E2_PREFIXO := "FRE"
				SE2->E2_NUM	    := aParametros[8]
				SE2->E2_PARCELA := "A"
				SE2->E2_NATUREZ := "2.03.004" //&(SuperGetMv("MV_IRF"))
				SE2->E2_TIPO	 := "NF"
				SE2->E2_EMISSAO := date()
				SE2->E2_VALOR   := aParametros[13]
				SE2->E2_ORIGEM	 := "MATA100"
				SE2->E2_SALDO   := aParametros[13] 
			  //	SE2->E2_VENCREA := aParametros[14] 	Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.
			  //	SE2->E2_VENCTO  := aParametros[14]	Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.
			  //	SE2->E2_VENCORI := aParametros[14]	Alterado pelo Wellyngton - ErpWorks 24/02/2015 solictação do Alexandre para a data de vencimento ser calculado conforme a forma de pagamento.
			  	SE2->E2_VENCREA := dDatavenc
				SE2->E2_VENCTO  := dDatavenc
				SE2->E2_VENCORI := dDatavenc
				
				SE2->E2_EMIS1   := Date()
				SE2->E2_FORNECE := aParametros[10]
				SE2->E2_LOJA	 := cLoja
				SE2->E2_NOMFOR  := Posicione("SA2",1,xFilial("SA2")+aParametros[10]+cLoja,"A2_NREDUZ")
				SE2->E2_MOEDA   := 1
				SE2->E2_VLCRUZ  := aParametros[13]
				SE2->E2_STATUS  := "A"   //Iif(SE1->E1_SALDO>0.01,"A","B")
				Msunlock()
				
				MsgInfo("Duplicata N: '"+aParametros[08]+"' GERADA COM SUCESSO")
				
			Else      //Exclui   (Criar campos para fornecedor e loja na hora de gravar)
				
				cNum := SF2->F2_COFRETE
				cSer := SF2->F2_SERFRET
				cFor := SF2->F2_COFOR
				cLoja := SF2->F2_COLOJ
				
				RecLock("SF2",.F.)
				
				SF2->F2_COFRETE := ""
				SF2->F2_SERFRET := ""
				SF2->F2_VALFRET := 0
				SF2->F2_COFOR := ""
				SF2->F2_COLOJ := ""
				
				MsUnlock()
				
				DbSelectArea("SE2")
				DbSetOrder(1)
				DbSeek(xFilial("SE2")+"FRE"+cNum+"A"+"NF")
				If Found()
					RecLock("SE2",.F.)
					dbDelete()
					Msunlock()
				EndIF
				
				DbSelectArea("SF1")
				DbSetOrder(1)
				DbSeek(xFilial("SF1")+cNum+cSer+cFor+cLoja+"C")
				If Found()
					RecLock("SF1",.F.)
					dbDelete()
					Msunlock()
				EndIF
				
				DbSelectArea("SD1")
				DbSetOrder(1)
				DbSeek(xFilial("SD1")+cNum+cSer+cFor+cLoja)
				If Found()
					RecLock("SD1",.F.)
					dbDelete()
					Msunlock()
				EndIF
				
			EndIF
			aadd(aDados,{SF2->F2_DOC,SF2->F2_SERIE,SF2->F2_CLIENTE,SF2->F2_LOJA} )
			
		EndIf
		
	EndIf
	
	dbSkip()
	
EndDo

//EndFilBrw("SF2",aIndexSF1)
RetIndex("SF2")

MsUnlockAll()
CloseBrowse()


Return .T.
