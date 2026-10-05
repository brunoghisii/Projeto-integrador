const eyeOpenSVG = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
const eyeClosedSVG = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;

function setupToggle(buttonId, fieldId, iconId) {
    const btn = document.getElementById(buttonId);
    if (btn) {
        btn.addEventListener('click', () => {
            const field = document.getElementById(fieldId);
            const icon = document.getElementById(iconId);
            const isPassword = field.getAttribute('type') === 'password';
            
            field.setAttribute('type', isPassword ? 'text' : 'password');
            if (icon) icon.innerHTML = isPassword ? eyeClosedSVG : eyeOpenSVG;
        });
    }
}

setupToggle('toggleSenha', 'senha', 'eye-senha');
setupToggle('toggleConfirmar', 'confirmar-senha', 'eye-confirmar');

const form = document.getElementById('form-nova-senha');
form.addEventListener('submit', (e) => {
    e.preventDefault();

    const senha = document.getElementById('senha').value;
    const confirmarSenha = document.getElementById('confirmar-senha').value;
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (senha !== confirmarSenha) {
        alert('As senhas não coincidem!');
        document.getElementById('confirmar-senha').style.borderColor = '#EF4444';
        return;
    }

    const dadosAtualizacao = {
        token: token,
        novaSenha: senha
    };

    const API_URL = '/api/pacientes/redefinir-senha';

    fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify(dadosAtualizacao)
    })
    .then(response => {
        if (response.ok) {
            alert('Senha atualizada com sucesso! Você já pode entrar.');
            window.location.href = '../login/index.html';
        } else {
            alert('Link expirado ou inválido. Solicite uma nova recuperação.');
        }
    })
    .catch(() => {
        alert('Simulação: Senha atualizada com sucesso!');
        window.location.href = '../login/index.html';
    });
});