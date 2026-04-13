const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const crypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');

function emailValido(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

function senhaForte(senha) {
    return (
        senha.length >= 8 &&
        /[A-Z]/.test(senha) &&
        /[a-z]/.test(senha) &&
        /[0-9]/.test(senha)
    );
}

// server.js
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const axios = require('axios');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;

// ================== MIDDLEWARE ==================
app.use(cors({
    origin: [
        'https://praticaecommerce.vercel.app',
        'https://www.praticaindecom.com.br',
        'http://127.0.0.1:5502',
        'http://localhost:5502'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

const path = require('path'); // Adicione isso no topo do arquivo com os outros requires

function verificarAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) return res.sendStatus(401);

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded.admin) return res.sendStatus(403);

        next();
    } catch {
        return res.sendStatus(403);
    }
}

// Altere a linha do static para esta:
app.use(express.static(path.join(__dirname, '..')));

// ================== BANCO ==================
const db = mysql.createConnection(process.env.MYSQL_URL);

db.connect(err => {
    if (err) {
        console.error('Erro MySQL:', err);
        return;
    }
    console.log('MySQL conectado');
});

// ================== EMAIL ==================
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ================== MERCADO PAGO ==================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// ================== CADASTRO ==================
app.post('/cadastro', async (req, res) => {
    try {
        const { login, senha, email, nome, cpf, telefone } = req.body;

        // Campos obrigatórios
        if (!login || !senha || !email || !nome || !cpf || !telefone) {
            return res.status(400).json({
                sucesso: false,
                msg: 'Campos obrigatórios ausentes'
            });
        }

        // Email inválido
        if (!emailValido(email)) {
            return res.status(400).json({
                sucesso: false,
                msg: 'Email inválido'
            });
        }


        // Senha fraca
        if (!senhaForte(senha)) {
            return res.status(400).json({
                sucesso: false,
                msg: 'Senha fraca. Use no mínimo 8 caracteres, maiúscula, minúscula e número.'
            });
        }

        const hash = await bcrypt.hash(senha, 10);

        const sql = `
            INSERT INTO usuario (login, senha, email, nome, cpf, telefone)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [login, hash, email, nome, cpf, telefone], err => {
            if (err) {
                if (err.errno === 1062) {

                    if (err.sqlMessage.includes('cpf')) {
                        return res.status(409).json({
                            sucesso: false,
                            msg: 'CPF já cadastrado'
                        });
                    }

                    if (err.sqlMessage.includes('telefone')) {
                        return res.status(409).json({
                            sucesso: false,
                            msg: 'Telefone já cadastrado'
                        });
                    }

                    if (err.sqlMessage.includes('email')) {
                        return res.status(409).json({
                            sucesso: false,
                            msg: 'Email já cadastrado'
                        });
                    }

                    if (err.sqlMessage.includes('login')) {
                        return res.status(409).json({
                            sucesso: false,
                            msg: 'Login já cadastrado'
                        });
                    }

                    return res.status(409).json({
                        sucesso: false,
                        msg: 'Dados já cadastrados'
                    });
                }

                console.error(err);
                return res.status(500).json({
                    sucesso: false,
                    msg: 'Erro interno no servidor'
                });
            }

            res.json({ sucesso: true });
        });


    } catch (err) {
        console.error('Erro no cadastro:', err);
        res.status(500).json({
            sucesso: false,
            msg: 'Erro interno no servidor'
        });
    }
});

// ================== LOGIN ==================
app.post('/login', (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.json({ sucesso: false });
    }

    db.query(
        'SELECT * FROM usuario WHERE email = ?',
        [email],
        async (err, results) => {
            if (err || results.length === 0) {
                return res.json({ sucesso: false });
            }

            const user = results[0];
            const ok = await bcrypt.compare(senha, user.senha);

            if (!ok) {
                return res.json({ sucesso: false });
            }

            // 👉 RETORNAR O LOGIN DO BANCO
            res.json({
                sucesso: true,
                usuario: { // Os dados estão envelopados aqui
                    id: user.id,
                    nome: user.nome,
                    login: user.login,
                    telefone: user.telefone,
                    email: user.email,
                    cpf: user.cpf
                }
            });

        }
    );
});

// ================== SALVAR PEDIDO (APENAS ENDEREÇO) ==================
app.post('/pedido', async (req, res) => {
    try {
        const {
            usuario_id,
            rua,
            numero,
            cidade,
            estado,
            cep,
            itens
        } = req.body;

        if (!usuario_id) {
            return res.status(401).json({ sucesso: false, msg: 'Usuário não autenticado' });
        }

        if (!itens || !Array.isArray(itens) || itens.length === 0) {
            return res.status(400).json({ sucesso: false, msg: 'Pedido sem itens' });
        }

        // 1️⃣ Buscar usuário
        const [userRows] = await db.promise().query(
            'SELECT nome, email, telefone FROM usuario WHERE id = ?',
            [usuario_id]
        );

        if (userRows.length === 0) {
            return res.status(400).json({ sucesso: false, msg: 'Usuário não encontrado' });
        }

        const { nome, email, telefone } = userRows[0];

        // 2️⃣ Criar pedido com valor 0 (temporário)
        const [pedidoResult] = await db.promise().query(
            `
      INSERT INTO pedidos
      (nome, telefone, rua, numero, cidade, estado, cep, valor, status, usuario_id, email)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pendente', ?, ?)
      `,
            [nome, telefone, rua, numero, cidade, estado, cep, usuario_id, email]
        );

        const pedidoId = pedidoResult.insertId;
        let valorTotal = 0;
    
        // 3️⃣ Processar itens
        for (const item of itens) {
            const [prodRows] = await db.promise().query(
                'SELECT nome, preco, imagem FROM produtos WHERE id = ? AND ativo = true',
                [item.produto_id]
            );

            if (prodRows.length === 0) {
                return res.status(400).json({
                    sucesso: false,
                    msg: `Produto ${item.produto_id} não encontrado`
                });
            }

            const produto = prodRows[0];
            const precoUnitario = Number(produto.preco);
            const quantidade = Number(item.quantidade);
            const subtotal = precoUnitario * quantidade;

            valorTotal += subtotal;

            await db.promise().query(
                `
        INSERT INTO pedido_itens
        (pedido_id, produto_id, cor, quantidade, preco_unitario, subtotal, imagem)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
                [
                    pedidoId,
                    item.produto_id,
                    item.cor,
                    quantidade,
                    precoUnitario,
                    subtotal,
                    item.imagem
                ]
            );
        }

        // 4️⃣ Atualiza valor real do pedido
        await db.promise().query(
            'UPDATE pedidos SET valor = ? WHERE id = ?',
            [valorTotal, pedidoId]
        );

        // 5️⃣ Enviar email (ASSÍNCRONO - NÃO trava a resposta)
        await resend.emails.send({
            from: process.env.EMAIL_FROM,
            to: email,
            subject: 'Confirmação do seu pedido - Prática Indústria & Comércio',
            html: `
<div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; line-height: 1.6;">

    <h2 style="color: #2c2c2c;">Olá, ${nome}!</h2>

    <p>
        Recebemos seu pedido com sucesso!<br>
        Ele já está registrado em nosso sistema e aguardando o pagamento para ser processado.
    </p>

    <p>
        💡 Assim que o pagamento for confirmado, iniciaremos a separação e envio dos seus produtos.
    </p>

    <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">

    <p style="margin-top: 15px;">
        <strong>Total:</strong><br>
        R$ ${valorTotal.toFixed(2)}
    </p>

    <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">

    <h3>📍 Endereço de entrega</h3>
    <p>
        ${rua}, ${numero}<br>
        ${cidade} - ${estado}<br>
        CEP: ${cep}
    </p>

    <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">

    <p>
        ⏳ <strong>Status do pedido:</strong> Aguardando pagamento
    </p>

    <p>
        Para finalizar sua compra, realize o pagamento utilizando o método escolhido no site.
    </p>

    <p style="margin-top: 20px;">
        ⚠️ Caso o pagamento não seja realizado, o pedido poderá ser cancelado automaticamente.
    </p>

    <p style="margin-top: 25px;">
        Qualquer dúvida, estamos à disposição 😊
    </p>

    <p style="margin-top: 25px;">
        Atenciosamente,<br>
        <strong>Equipe Prática Indústria & Comércio</strong>
    </p>

    <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">

    <small style="color: #777;">
        Este é um e-mail automático. Por favor, não responda.
    </small>

</div>
`
        })
            .then(() => {
                console.log(`📧 E-mail enviado para: ${email}`);
            })
            .catch(err => {
                console.error("❌ Erro ao enviar email:", err.message);
            });

        // ✅ SEMPRE responde sucesso
        res.json({
            sucesso: true,
            pedidoId,
            valor: valorTotal
        });

    } catch (err) {
        console.error('Erro no pedido:', err);
        res.status(500).json({ sucesso: false, msg: 'Erro no servidor' });
    }
});

app.get('/meus-pedidos/:usuarioId', async (req, res) => {
    try {
        const usuarioId = req.params.usuarioId;

        const [pedidos] = await db.promise().query(
            'SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY id DESC',
            [usuarioId]
        );

        for (const pedido of pedidos) {
            const [itens] = await db.promise().query(
                'SELECT pi.*, p.nome AS produto_nome FROM pedido_itens pi JOIN produtos p ON pi.produto_id = p.id WHERE pi.pedido_id = ?',
                [pedido.id]
            );
            pedido.itens = itens;
        }

        res.json(pedidos);

    } catch (err) {
        console.error(err);
        res.status(500).json({ sucesso: false });
    }
});

app.post('/pedido/:id/solicitar-reembolso', async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const { usuarioId, motivo } = req.body;

        if (!usuarioId) {
            return res.status(401).json({
                sucesso: false,
                msg: 'Usuário não autenticado'
            });
        }

        const [rows] = await db.promise().query(
            'SELECT * FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        if (!rows.length) {
            return res.status(404).json({
                sucesso: false,
                msg: 'Pedido não encontrado'
            });
        }

        const pedido = rows[0];

        if (pedido.usuario_id != usuarioId) {
            return res.status(403).json({
                sucesso: false,
                msg: 'Você não pode solicitar reembolso deste pedido'
            });
        }

        if (pedido.status !== 'pago') {
            return res.status(400).json({
                sucesso: false,
                msg: 'Somente pedidos pagos podem solicitar reembolso'
            });
        }

        await db.promise().query(
            `UPDATE pedidos
             SET status = 'reembolso_solicitado',
                 refund_motivo = ?,
                 refund_solicitado_em = NOW()
             WHERE id = ?`,
            [motivo || null, pedidoId]
        );

        res.json({
            sucesso: true,
            msg: 'Solicitação de reembolso enviada com sucesso'
        });

    } catch (err) {
        console.error('Erro ao solicitar reembolso:', err);
        res.status(500).json({
            sucesso: false,
            msg: 'Erro interno no servidor'
        });
    }
});

app.post('/pedido/:id/cancelar', async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const { usuarioId } = req.body;

        if (!usuarioId) {
            return res.status(401).json({
                sucesso: false,
                msg: 'Usuário não autenticado'
            });
        }

        // 1️⃣ Buscar pedido completo
        const [rows] = await db.promise().query(
            'SELECT * FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                sucesso: false,
                msg: 'Pedido não encontrado'
            });
        }

        const pedido = rows[0];

        // 2️⃣ Segurança (dono do pedido)
        if (pedido.usuario_id != usuarioId) {
            return res.status(403).json({
                sucesso: false,
                msg: 'Você não pode cancelar este pedido'
            });
        }

        // 3️⃣ Regras de negócio
        if (pedido.status === 'cancelado') {
            return res.status(400).json({
                sucesso: false,
                msg: 'Pedido já está cancelado'
            });
        }

        if (pedido.status === 'pago') {
            return res.status(400).json({
                sucesso: false,
                msg: 'Pedido já foi pago. Entre em contato para reembolso.'
            });
        }

        if (pedido.status !== 'pendente') {
            return res.status(400).json({
                sucesso: false,
                msg: `Pedido não pode ser cancelado (status: ${pedido.status})`
            });
        }

        // 4️⃣ Cancelar
        await db.promise().query(
            'UPDATE pedidos SET status = "cancelado" WHERE id = ?',
            [pedidoId]
        );

        // 5️⃣ (OPCIONAL) enviar email
        try {
            await resend.emails.send({
                from: process.env.EMAIL_FROM,
                to: pedido.email,
                subject: 'Pedido cancelado',
                html: `
                    <h2>Pedido #${pedidoId} cancelado</h2>
                    <p>Seu pedido foi cancelado com sucesso.</p>
                `
            });
        } catch (err) {
            console.error('Erro ao enviar email de cancelamento:', err.message);
        }

        res.json({
            sucesso: true,
            msg: 'Pedido cancelado com sucesso'
        });

    } catch (err) {
        console.error('Erro ao cancelar pedido:', err);
        res.status(500).json({
            sucesso: false,
            msg: 'Erro interno no servidor'
        });
    }
});

// ================== ALTERAR SENHA ==================
app.post('/alterar-senha', async (req, res) => {
    try {
        const { usuarioId, senhaAtual, novaSenha } = req.body;

        // 1️⃣ Validação básica
        if (!usuarioId || !senhaAtual || !novaSenha) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Dados incompletos'
            });
        }

        // 2️⃣ Buscar usuário
        const [rows] = await db.promise().query(
            'SELECT senha FROM usuario WHERE id = ?',
            [usuarioId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Usuário não encontrado'
            });
        }

        const senhaHashBanco = rows[0].senha;

        // 3️⃣ Conferir senha atual
        const senhaCorreta = await bcrypt.compare(senhaAtual, senhaHashBanco);

        if (!senhaCorreta) {
            return res.status(401).json({
                sucesso: false,
                mensagem: 'Senha atual incorreta'
            });
        }

        // 4️⃣ Validar força da nova senha
        if (!senhaForte(novaSenha)) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'A nova senha é muito fraca'
            });
        }

        // 5️⃣ Gerar novo hash
        const novoHash = await bcrypt.hash(novaSenha, 10);

        // 6️⃣ Atualizar senha no banco
        await db.promise().query(
            'UPDATE usuario SET senha = ? WHERE id = ?',
            [novoHash, usuarioId]
        );

        // 7️⃣ Resposta final
        res.json({
            sucesso: true,
            mensagem: 'Senha alterado com sucesso'
        });

    } catch (err) {
        console.error('Erro ao alterar senha:', err);
        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro interno no servidor'
        });
    }
});

// ================== ALTERAR EMAIL ==================
app.post('/alterar-email', async (req, res) => {
    try {
        const { usuarioId, emailAtual, novoEmail } = req.body;

        if (!usuarioId || !emailAtual || !novoEmail) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Dados incompletos'
            });
        }

        if (emailAtual === novoEmail) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'O email já está cadastrado'
            });
        }

        if (!emailValido(novoEmail)) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Novo email inválido'
            });
        }

        const [rows] = await db.promise().query(
            'SELECT email FROM usuario WHERE id = ?',
            [usuarioId]
        );

        if (!rows.length) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Usuário não encontrado'
            });
        }

        // ✅ Comparação correta (string)
        if (rows[0].email !== emailAtual) {
            return res.status(401).json({
                sucesso: false,
                mensagem: 'Email atual incorreto'
            });
        }

        const [existente] = await db.promise().query(
            'SELECT id FROM usuario WHERE email = ? AND id != ?',
            [novoEmail, usuarioId]
        );

        if (existente.length > 0) {
            return res.status(409).json({
                sucesso: false,
                mensagem: 'Email já está cadastrado'
            });
        }

        // ✅ Atualiza email SEM hash
        await db.promise().query(
            'UPDATE usuario SET email = ? WHERE id = ?',
            [novoEmail, usuarioId]
        );

        res.json({
            sucesso: true,
            mensagem: 'Email alterado com sucesso'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro interno no servidor'
        });
    }
});

// ================== ALTERAR NOME ==================
app.post('/alterar-nome', async (req, res) => {
    try {
        const { usuarioId, nomeAtual, novoNome } = req.body;

        if (!usuarioId == null || !nomeAtual || !novoNome) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Dados incompletos'
            });
        }

        const [rows] = await db.promise().query(
            'SELECT nome FROM usuario WHERE id = ?',
            [usuarioId]
        );

        if (!rows.length) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Usuário não encontrado'
            });
        }

        // ✅ Comparação correta (string)
        if (rows[0].nome.trim().toLowerCase() !== nomeAtual.trim().toLowerCase()) {
            return res.status(401).json({
                sucesso: false,
                mensagem: 'Nome atual incorreto'
            });
        }

        // ✅ Atualiza email SEM hash
        await db.promise().query(
            'UPDATE usuario SET nome = ? WHERE id = ?',
            [novoNome, usuarioId]
        );

        res.json({
            sucesso: true,
            mensagem: 'Nome alterado com sucesso'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro interno no servidor'
        });
    }
});

// ================== ALTERAR TELEFONE ==================
app.post('/alterar-telefone', async (req, res) => {
    try {
        const { usuarioId, telefoneAtual, novoTelefone } = req.body;

        if (!usuarioId || !telefoneAtual || !novoTelefone) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Dados incompletos'
            });
        }

        const [rows] = await db.promise().query(
            'SELECT telefone FROM usuario WHERE id = ?',
            [usuarioId]
        );

        if (!rows.length) {
            return res.status(404).json({
                sucesso: false,
                mensagem: 'Usuário não encontrado'
            });
        }

        const [existente] = await db.promise().query(
            'SELECT id FROM usuario WHERE telefone = ? AND id != ?',
            [novoTelefone, usuarioId]
        );

        if (existente.length > 0) {
            return res.status(409).json({
                sucesso: false,
                mensagem: 'Telefone já está cadastrado'
            });
        }

        // ✅ Comparação correta (string)
        if (rows[0].telefone !== telefoneAtual) {
            return res.status(401).json({
                sucesso: false,
                mensagem: 'Telefone atual incorreto'
            });
        }

        // ✅ Atualiza telefone SEM hash
        await db.promise().query(
            'UPDATE usuario SET telefone = ? WHERE id = ?',
            [novoTelefone, usuarioId]
        );

        res.json({
            sucesso: true,
            mensagem: 'Telefone alterado com sucesso'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro interno no servidor'
        });
    }
});

app.post('/esqueci-senha', async (req, res) => {
    const { email } = req.body;

    try {
        // 1. Verifica se o usuário existe e está ATIVO
        const [usuarios] = await db.promise().query(
            'SELECT id FROM usuario WHERE email = ? AND ativo = 1',
            [email]
        );

        if (usuarios.length === 0) {
            // Por segurança, não confirmamos se o e-mail existe ou não
            return res.json({ sucesso: true, msg: 'Se o e-mail existir, um link de recuperação foi enviado.' });
        }

        const usuarioId = usuarios[0].id;
        const token = crypto.randomBytes(20).toString('hex'); // Gera um token aleatório
        const expira = new Date();
        expira.setHours(expira.getHours() + 1); // Expira em 1 hora

        // 2. Salva o token no banco
        await db.promise().query(
            'UPDATE usuario SET reset_token = ?, reset_expira = ? WHERE id = ?',
            [token, expira, usuarioId]
        );

        // 3. Envia o e-mail
        const link = `https://pratica-api.onrender.com/redefinir-senha.html?token=${token}`;

        await resend.emails.send({
            from: process.env.EMAIL_FROM,
            to: email,
            subject: 'Recuperação de Senha - Prática Indústria & Comércio',
            html: `<h3>Recuperação de Senha</h3>
                   <p>Você solicitou a alteração de senha. Clique no link abaixo para criar uma nova senha:</p>
                   <a href="${link}">${link}</a>
                   <p>Este link expira em 1 hora.</p>`
        });

        res.json({ sucesso: true, msg: 'E-mail enviado com sucesso!' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ sucesso: false, msg: 'Erro ao processar solicitação' });
    }
});

app.post('/redefinir-senha', async (req, res) => {
    const { token, novaSenha } = req.body;

    try {
        // 1. Busca o usuário pelo token e vê se não expirou
        const [usuarios] = await db.promise().query(
            'SELECT id FROM usuario WHERE reset_token = ? AND reset_expira > NOW() AND ativo = 1',
            [token]
        );

        if (usuarios.length === 0) {
            return res.status(400).json({ sucesso: false, msg: 'Link inválido ou expirado.' });
        }

        // 2. Hash da nova senha e limpeza do token
        const novoHash = await bcrypt.hash(novaSenha, 10);
        await db.promise().query(
            'UPDATE usuario SET senha = ?, reset_token = NULL, reset_expira = NULL WHERE id = ?',
            [novoHash, usuarios[0].id]
        );

        res.json({ sucesso: true, msg: 'Senha alterada com sucesso!' });

    } catch (err) {
        res.status(500).json({ sucesso: false, msg: 'Erro ao redefinir senha.' });
    }
});

app.post('/pedido/:id/cartao', async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const {
            token,
            payment_method_id,
            issuer_id,
            installments,
            cpf,
            email
        } = req.body;

        if (!token || !payment_method_id || !cpf) {
            return res.status(400).json({
                sucesso: false,
                msg: 'Dados do cartão incompletos'
            });
        }

        const [rows] = await db.promise().query(
            'SELECT * FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        if (!rows.length) {
            return res.status(404).json({
                sucesso: false,
                msg: 'Pedido não encontrado'
            });
        }

        const pedido = rows[0];

        if (pedido.status === 'cancelado') {
            return res.status(400).json({
                sucesso: false,
                msg: 'Pedido cancelado não pode ser pago'
            });
        }

        if (pedido.status === 'pago') {
            return res.json({
                sucesso: false,
                msg: 'Pedido já foi pago'
            });
        }

        if (!pedido.valor || Number(pedido.valor) <= 0) {
            return res.status(400).json({
                sucesso: false,
                msg: 'Valor inválido'
            });
        }

        const pagamentoBody = {
            transaction_amount: Number(pedido.valor),
            token,
            description: `Pedido #${pedidoId}`,
            installments: Number(installments) || 1,
            payment_method_id,
            payer: {
                email: email || pedido.email,
                identification: {
                    type: "CPF",
                    number: cpf
                }
            },
            metadata: {
                pedido_id: pedidoId
            }
        };

        if (issuer_id) {
            pagamentoBody.issuer_id = issuer_id;
        }

        const pagamento = await axios.post(
            'https://api.mercadopago.com/v1/payments',
            pagamentoBody,
            {
                headers: {
                    Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': uuidv4()
                }
            }
        );

        const status = pagamento.data.status;

        if (status === 'approved') {
            await db.promise().query(
                'UPDATE pedidos SET status = "pago", payment_id = ? WHERE id = ?',
                [pagamento.data.id, pedidoId]
            );
        }

        res.json({
            sucesso: true,
            status,
            payment_id: pagamento.data.id
        });

    } catch (err) {
        console.error("Erro MP:", err.response?.data || err.message);

        res.status(500).json({
            sucesso: false,
            msg: err.response?.data?.message || 'Erro no pagamento com cartão'
        });
    }
});

// ================== GERAR PIX ==================
app.post('/pedido/:id/pix', async (req, res) => {
    try {
        const pedidoId = req.params.id;

        // 1️⃣ Buscar pedido no banco
        const [rows] = await db.promise().query(
            'SELECT * FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        // 2️⃣ Verifica se existe
        if (rows.length === 0) {
            return res.status(404).json({
                sucesso: false,
                msg: 'Pedido não encontrado'
            });
        }

        // 3️⃣ Agora sim cria o pedido
        const pedido = rows[0];

        if (pedido.status === 'cancelado') {
            return res.status(400).json({
                sucesso: false,
                msg: 'Pedido cancelado não pode ser pago'
            });
        }

        if (pedido.status === 'pago') {
            return res.json({
                sucesso: false,
                msg: 'Pedido já foi pago'
            });
        }

        // 4️⃣ Verifica se já tem PIX
        if (pedido.qr_code_base64) {
            return res.json({
                sucesso: true,
                qrCode: pedido.qr_code,
                qrBase64: pedido.qr_code_base64
            });
        }


        // 5️⃣ Valida valor
        if (!pedido.valor || Number(pedido.valor) <= 0) {
            return res.status(400).json({
                sucesso: false,
                msg: 'Valor inválido para pagamento'
            });
        }

        const idempotencyKey = uuidv4();

        // 6️⃣ Criar pagamento PIX
        const pix = await axios.post(
            'https://api.mercadopago.com/v1/payments',
            {
                transaction_amount: Number(pedido.valor),
                payment_method_id: 'pix',
                description: `Pedido #${pedidoId}`,
                payer: {
                    email: pedido.email,
                    first_name: pedido.nome
                },
                metadata: {
                    pedido_id: pedidoId
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': idempotencyKey
                }
            }
        );

        const data = pix.data.point_of_interaction.transaction_data;

        // 7️⃣ Salvar payment_id
        await db.promise().query(
            `
            UPDATE pedidos
            SET payment_id = ?, qr_code = ?, qr_code_base64 = ?
            WHERE id = ?
            `,
            [
                pix.data.id,
                data.qr_code,
                data.qr_code_base64,
                pedidoId
            ]
        );


        res.json({
            sucesso: true,
            qrCode: data.qr_code,
            qrBase64: data.qr_code_base64
        });

    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).json({
            sucesso: false,
            msg: 'Erro ao gerar PIX'
        });
    }
});

app.get('/pedido/:id/status', async (req, res) => {
    try {
        const pedidoId = req.params.id;

        const [rows] = await db.promise().query(
            'SELECT status FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        if (!rows.length) {
            return res.status(404).json({ sucesso: false });
        }

        res.json({
            sucesso: true,
            status: rows[0].status
        });

    } catch (err) {
        res.status(500).json({ sucesso: false });
    }
});

app.post('/webhook-mp', async (req, res) => {
    try {
        // 1. Captação de IDs e Cabeçalhos
        const paymentId = req.body.data?.id || req.query['data.id'] || req.body.id;
        const requestId = req.headers['x-request-id'];
        const signatureHeader = req.headers['x-signature'];

        console.log(`🔔 Notificação recebida: ID ${paymentId}`);

        // Se for uma notificação de teste ou sem ID, encerramos com 200
        if (!signatureHeader || !paymentId) {
            return res.status(200).send('OK');
        }

        // 2. Validação da Assinatura (Segurança Máxima)
        const secret = process.env.MP_WEBHOOK_SECRET.trim();
        const parts = signatureHeader.split(',');
        const ts = parts.find(p => p.startsWith('ts='))?.split('=')[1];
        const v1 = parts.find(p => p.startsWith('v1='))?.split('=')[1];

        if (!ts || !v1) {
            return res.sendStatus(200);
        }

        // Manifesto rigoroso exigido pelo Mercado Pago
        const manifesto = `id:${paymentId};request-id:${requestId};ts:${ts};`;
        const hashGerado = crypto.createHmac('sha256', secret).update(manifesto).digest('hex');

        if (hashGerado !== v1) {
            console.error('❌ Assinatura Inválida!');
            return res.sendStatus(403);
        }

        console.log('✅ Assinatura validada!');

        // 3. Filtrar apenas eventos de pagamento
        const topic = req.body.type || req.query.topic;
        if (topic !== 'payment') return res.sendStatus(200);

        // 4. Consulta do Status Real na API do Mercado Pago
        const consulta = await axios.get(
            `https://api.mercadopago.com/v1/payments/${paymentId}`,
            { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
        );

        const pagamento = consulta.data;

        // 5. Processamento se o pagamento for aprovado
        if (pagamento.status === 'approved') {
            const pedidoId = pagamento.metadata?.pedido_id;

            if (!pedidoId) {
                console.error('⚠️ Pagamento aprovado, mas sem pedido_id no metadata.');
                return res.sendStatus(200);
            }

            // Busca os dados do cliente e verifica se já processamos este e-mail
            const [pedidoRows] = await db.promise().query(
                'SELECT nome, email, email_pagamento_enviado FROM pedidos WHERE id = ?',
                [pedidoId]
            );

            if (pedidoRows.length > 0) {
                const pedido = pedidoRows[0];

                if (!pedido.email_pagamento_enviado) {
                    console.log(`⚙️ Processando pedido #${pedidoId}...`);

                    // A) Busca os itens para o corpo do e-mail
                    const [itens] = await db.promise().query(`
                        SELECT 
                            pi.quantidade,
                            pi.preco_unitario,
                            p.nome
                        FROM pedido_itens pi
                        JOIN produtos p ON p.id = pi.produto_id
                        WHERE pi.pedido_id = ?
                    `, [pedidoId]);


                    const itensHtml = itens.map(i =>
                        `<li>${i.quantidade}x Produto #${i.nome} - R$ ${i.preco_unitario}</li>`
                    ).join('');

                    // B) Atualiza o Banco de Dados (Trava de segurança primeiro)
                    await db.promise().query(
                        'UPDATE pedidos SET status = "pago", payment_id = ?, email_pagamento_enviado = 1 WHERE id = ?',
                        [paymentId, pedidoId]
                    );

                    // C) Envio do E-mail
                    await resend.emails.send({
                        from: process.env.EMAIL_FROM,
                        to: pedido.email,
                        subject: 'Pagamento aprovado! 🎉',
                        html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; line-height: 1.6;">

        <h2 style="color: #2c2c2c;">Olá, ${pedido.nome}!</h2>

        <p>
            Temos uma ótima notícia<br>
            O pagamento do seu pedido <strong>#${pedidoId}</strong> foi confirmado com sucesso!
        </p>

        <p>
            A partir de agora, já iniciamos a separação e preparação dos seus produtos com todo o cuidado 💛
        </p>

        <h3 style="margin-top: 24px;">🧾 Detalhes do pedido</h3>
        <ul style="padding-left: 18px;">
            ${itensHtml}
        </ul>

        <p style="margin-top: 20px;">
            📦 <strong>Envio:</strong><br>
            Em até <strong>48 horas</strong>, você receberá um novo e-mail com o 
            <strong>código de rastreamento</strong>.
        </p>

        <p>
            Caso tenha qualquer dúvida, é só responder este e-mail 😊
        </p>

        <p style="margin-top: 24px;">
            Obrigado por escolher a <strong>Prática Indústria & Comércio</strong>.
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">

        <small style="color: #777;">
            Código da transação: ${paymentId}
        </small>
        </div>
    `
                    }).then(() => {
                        console.log(`📧 E-mail enviado para: ${pedido.email}`);
                    }).catch(err => {
                        console.error('❌ Erro ao enviar e-mail:', err.message);
                    });
                } else {
                    console.log(`ℹ️ Pedido ${pedidoId} já foi notificado anteriormente.`);
                }
            }
        }

        // 6. Resposta Final para o Mercado Pago
        res.sendStatus(200);

    } catch (err) {
        console.error('💥 Erro no Webhook:', err.response?.data || err.message);
        res.sendStatus(500);
    }
});

// ================== EXCLUIR CONTA (SOFT DELETE) ==================
app.post('/excluir-conta', async (req, res) => {
    try {
        const { usuarioId, senha } = req.body;

        if (!usuarioId || !senha) {
            return res.status(400).json({ sucesso: false, msg: 'Dados incompletos' });
        }

        // 1. Buscar a senha do usuário
        const [rows] = await db.promise().query(
            'SELECT senha FROM usuario WHERE id = ?',
            [usuarioId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ sucesso: false, msg: 'Usuário não encontrado' });
        }

        // 2. Validar a senha
        const senhaHash = rows[0].senha;
        const senhaCorreta = await bcrypt.compare(senha, senhaHash);

        if (!senhaCorreta) {
            return res.status(401).json({ sucesso: false, msg: 'Senha incorreta' });
        }

        // 3. "Excluir" a conta (Soft Delete)
        // Dica: Adicione uma coluna 'ativo' (boolean) na sua tabela de usuários se ainda não tiver.
        // Ou você pode simplesmente mudar o e-mail para algo como "deletado_123@excluido.com" 
        // para liberar o e-mail original para novos cadastros.
        // 3. "Excluir" a conta (Soft Delete)
        await db.promise().query(
            `UPDATE usuario 
            SET ativo = 0,
                            login = CONCAT('deleted_', id, '_', login),
                            email = CONCAT('deleted_', id, '_', email),
                            cpf = CONCAT('del_', id, '_', cpf),
                            telefone = CONCAT('del_', id, '_', telefone) 
            WHERE id = ? `,
            [usuarioId]
        );

        res.json({ sucesso: true, msg: 'Conta desativada com sucesso' });

    } catch (err) {
        console.error('Erro ao excluir conta:', err);
        res.status(500).json({ sucesso: false, msg: 'Erro interno no servidor' });
    }
});

app.post('/admin/login', (req, res) => {
    const { email, senha } = req.body;

    // 🔒 ideal: vir do banco (vou simplificar)
    if (
        email === process.env.ADMIN_EMAIL &&
        senha === process.env.ADMIN_PASSWORD
    ) {
        const token = jwt.sign(
            { admin: true },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.json({ sucesso: true, token });
    }

    res.status(401).json({ sucesso: false });
});

app.get("/admin/pedidos", verificarAdmin, async (req, res) => {
    try {
        const [rows] = await db.promise().query(`
            SELECT 
                p.id AS pedido_id,
                p.nome,
                p.telefone,
                p.email,
                p.rua,
                p.numero,
                p.cidade,
                p.estado,
                p.cep,
                p.valor,
                p.status,

                i.id AS item_id,
                i.produto_id,
                i.quantidade,
                i.preco_unitario,
                i.subtotal,
                i.cor,
                i.imagem,

                pr.nome AS produto_nome

            FROM pedidos p
            LEFT JOIN pedido_itens i ON p.id = i.pedido_id
            LEFT JOIN produtos pr ON pr.id = i.produto_id
            ORDER BY p.id DESC
        `);

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ sucesso: false });
    }
});

app.post('/admin/pedido/:id/reembolsar', verificarAdmin, async (req, res) => {
    try {
        const pedidoId = req.params.id;

        const [rows] = await db.promise().query(
            'SELECT * FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        if (!rows.length) {
            return res.status(404).json({
                sucesso: false,
                msg: 'Pedido não encontrado'
            });
        }

        const pedido = rows[0];

        if (pedido.status !== 'reembolso_solicitado') {
            return res.status(400).json({
                sucesso: false,
                msg: 'Pedido não está aguardando reembolso'
            });
        }

        if (!pedido.payment_id) {
            return res.status(400).json({
                sucesso: false,
                msg: 'payment_id não encontrado'
            });
        }

        const resposta = await axios.post(
            `https://api.mercadopago.com/v1/payments/${pedido.payment_id}/refunds`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        await db.promise().query(
            `UPDATE pedidos
             SET status = 'reembolsado',
                 refund_id = ?,
                 refund_valor = ?,
                 refund_data = NOW(),
                 refund_autorizado_em = NOW()
             WHERE id = ?`,
            [
                String(resposta.data.id || ''),
                Number(resposta.data.amount || pedido.valor),
                pedidoId
            ]
        );

        try {
            await resend.emails.send({
                from: process.env.EMAIL_FROM,
                to: pedido.email,
                subject: 'Reembolso aprovado',
                html: `
                    <h2>Reembolso aprovado</h2>
                    <p>O reembolso do seu pedido #${pedidoId} foi autorizado com sucesso.</p>
                `
            });
        } catch (err) {
            console.error('Erro ao enviar e-mail de reembolso:', err.message);
        }

        res.json({
            sucesso: true,
            msg: 'Reembolso realizado com sucesso'
        });

    } catch (err) {
        console.error('Erro ao reembolsar:', err.response?.data || err.message);
        res.status(500).json({
            sucesso: false,
            msg: err.response?.data?.message || 'Erro ao processar reembolso'
        });
    }
});

app.post('/admin/pedido/:id/recusar-reembolso', verificarAdmin, async (req, res) => {
    try {
        const pedidoId = req.params.id;

        const [rows] = await db.promise().query(
            'SELECT * FROM pedidos WHERE id = ?',
            [pedidoId]
        );

        if (!rows.length) {
            return res.status(404).json({
                sucesso: false,
                msg: 'Pedido não encontrado'
            });
        }

        const pedido = rows[0];

        if (pedido.status !== 'reembolso_solicitado') {
            return res.status(400).json({
                sucesso: false,
                msg: 'Pedido não está aguardando reembolso'
            });
        }

        await db.promise().query(
            `UPDATE pedidos
             SET status = 'reembolso_recusado'
             WHERE id = ?`,
            [pedidoId]
        );

        res.json({
            sucesso: true,
            msg: 'Solicitação de reembolso recusada'
        });

    } catch (err) {
        console.error('Erro ao recusar reembolso:', err);
        res.status(500).json({
            sucesso: false,
            msg: 'Erro interno no servidor'
        });
    }
});

// ================== SERVER ==================
app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});