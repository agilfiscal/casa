# Casa de Yann

Site da lista de compras e do orçamento da casa, gerado a partir da planilha `Casa_de_Yann.xlsx`.

- **Visitantes** (qualquer pessoa com o link): veem tudo, somente leitura.
- **Dono** (só você): clica em **Entrar para editar**, cola o token e edita direto no site.
  Cada "Salvar" grava o arquivo `data.json` no repositório (fica um histórico de versões no GitHub).

## Publicar (uma vez só)

1. Crie um repositório **público** no GitHub (ex.: `casa`) e envie estes arquivos.
2. No repositório: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
3. Em ~1 minuto o site fica em `https://agilfiscal.github.io/casa/`. Esse é o link para compartilhar.

## Criar o token de edição (só você)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** *Only select repositories* → escolha `casa`.
3. **Permissions → Repository permissions → Contents: Read and write**.
4. Gere e copie o token (`github_pat_…`).
5. No site, clique em **Entrar para editar**, confirme o repositório (`agilfiscal/casa`) e cole o token.

O token fica salvo só no seu navegador. Use **Sair** em computadores de outras pessoas.
Ninguém sem o token consegue editar: o próprio GitHub recusa a gravação.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html`, `style.css`, `app.js` | O site |
| `data.json` | Os dados (itens, orçamento, prioridades) |
