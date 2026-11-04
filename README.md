# Terra CAD 4

Topografia e terraplenagem no navegador: nuvem de pontos → TIN restrita → planta e 3D, curvas de nível, perfil com greide editável, seções, plataformas com taludes, volumes e exportação DXF/LandXML.

Veja **LEIA-ME-V4.md** para as novidades desta versão, **LEIA-ME-V3.md** para curvas/volumes/exportação e **LEIA-ME-V2.md** para o fluxo de triangulação.

## Usar o pacote pronto

Extraia todo o ZIP, instale Node.js 22.12+ e abra INICIAR-WINDOWS.cmd. Acesse http://127.0.0.1:4173/ e mantenha o terminal aberto. Não precisa de npm install para usar dist/ já compilado. Em outros sistemas: node serve.mjs.

## Desenvolver

npm ci
npm run dev
npm test
npm run build

A entrada atual é src/v4.jsx e src/AppV4.jsx, com renderer src/components/ViewportV4.jsx, editor src/components/ProfileEditor.jsx e seções src/components/SectionViewer.jsx. As versões 1 a 3 ficam preservadas como referência, sem uso na entrada atual.

O exemplo exemplos/levantamento-concavo.csv permite testar a triangulação em L. Importe e desenhe o contorno A → B → C → D → E → F; concluir recorta a área vazia entre os dois braços. A ordem dos pontos no arquivo não é inferida automaticamente como contorno.

Referência do algoritmo CDT: https://github.com/mikolalysenko/cdt2d
