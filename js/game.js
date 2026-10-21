(function () {
    'use strict';

    var W = 1920, H = 1080;
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    // ---- Klávesy dálkového ovladače Tizen ----
    // Zpět: Tizen 10009, Philips (Titan OS) 461, JVC (Titan OS) 8, prohlížeč Esc 27
    var KEY = { LEFT: 37, RIGHT: 39, ENTER: 13, SPACE: 32, PLAYPAUSE: 10252, P: 80 };
    var BACK_KEYS = [10009, 461, 8, 27];

    try {
        if (window.tizen && tizen.tvinputdevice) {
            ['MediaPlayPause', 'MediaPlay', 'MediaPause'].forEach(function (k) {
                try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* klávesa nepodporována */ }
            });
        }
    } catch (e) { /* mimo Tizen */ }

    var held = { left: false, right: false };

    // ---- Zvuk (WebAudio, volitelný) ----
    var audio = null;
    try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) { audio = new AC(); }
    } catch (e) { audio = null; }

    function beep(freq, dur, type, vol) {
        if (!audio) { return; }
        try {
            var o = audio.createOscillator();
            var g = audio.createGain();
            o.type = type || 'square';
            o.frequency.value = freq;
            g.gain.value = vol || 0.05;
            g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
            o.connect(g);
            g.connect(audio.destination);
            o.start();
            o.stop(audio.currentTime + dur);
        } catch (e) { /* ignorovat */ }
    }

    // ---- Konstanty hry ----
    var COLS = 12, BRICK_W = 140, BRICK_H = 46, GAP = 10;
    var FIELD_X = (W - (COLS * (BRICK_W + GAP) - GAP)) / 2;
    var FIELD_Y = 150;
    var PADDLE_H = 26, PADDLE_Y = H - 90;
    var PADDLE_BASE = 220, PADDLE_SPEED = 1300;
    var BALL_R = 13;
    var COLORS = ['#ff4d4d', '#ff944d', '#ffd84d', '#6fe06f', '#4dd2ff', '#6f7bff', '#c06fff', '#ff6fb5'];

    var LEVELS = [
        function (r, c) { return r < 5; },
        function (r, c) { return r < 6 && (r + c) % 2 === 0; },
        function (r, c) { return r < 7 && (c % 3 !== 2); },
        function (r, c) { return r < 7 && Math.abs(c - 5.5) <= r + 0.5; },
        function (r, c) { return r < 8 && !(r % 3 === 2 && c > 1 && c < 10); },
        function (r, c) { return r < 8 && (r === 0 || r === 7 || c === 0 || c === 11 || (r + c) % 4 === 0); }
    ];

    var state = 'title'; // title | ready | play | paused | gameover | win
    var score, lives, level, hiScore = 0;
    var paddle, balls, bricks, powerups, particles, flash;
    var lastTime = 0;

    try { hiScore = parseInt(localStorage.getItem('arkanoid.hi'), 10) || 0; } catch (e) { hiScore = 0; }

    function saveHi() {
        if (score > hiScore) {
            hiScore = score;
            try { localStorage.setItem('arkanoid.hi', String(hiScore)); } catch (e) { /* ignorovat */ }
        }
    }

    function newGame() {
        score = 0;
        lives = 3;
        level = 0;
        startLevel();
    }

    function startLevel() {
        var pattern = LEVELS[level % LEVELS.length];
        bricks = [];
        for (var r = 0; r < 8; r++) {
            for (var c = 0; c < COLS; c++) {
                if (pattern(r, c)) {
                    var tough = level >= 2 && r === 0;
                    bricks.push({
                        x: FIELD_X + c * (BRICK_W + GAP),
                        y: FIELD_Y + r * (BRICK_H + GAP),
                        hp: tough ? 2 : 1,
                        color: COLORS[r % COLORS.length]
                    });
                }
            }
        }
        powerups = [];
        particles = [];
        paddle = { w: PADDLE_BASE, x: W / 2 - PADDLE_BASE / 2, widenUntil: 0 };
        resetBall();
        state = 'ready';
    }

    function ballSpeed() { return 640 + level * 50; }

    function resetBall() {
        balls = [{ x: paddle.x + paddle.w / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, stuck: true, slowUntil: 0 }];
    }

    function launch() {
        var s = ballSpeed();
        var a = (Math.random() * 0.6 - 0.3);
        for (var i = 0; i < balls.length; i++) {
            if (balls[i].stuck) {
                balls[i].stuck = false;
                balls[i].vx = Math.sin(a) * s;
                balls[i].vy = -Math.cos(a) * s;
            }
        }
        state = 'play';
        beep(440, 0.08, 'triangle');
    }

    function burst(x, y, color) {
        for (var i = 0; i < 12; i++) {
            var a = Math.random() * Math.PI * 2, s = 100 + Math.random() * 300;
            particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, color: color });
        }
    }

    function spawnPowerup(x, y) {
        if (Math.random() > 0.2) { return; }
        var types = ['W', 'M', 'S', 'L'];
        powerups.push({ x: x, y: y, type: types[Math.floor(Math.random() * types.length)] });
    }

    function applyPowerup(type, now) {
        beep(880, 0.15, 'sine', 0.08);
        if (type === 'W') {
            paddle.widenUntil = now + 12000;
        } else if (type === 'M') {
            var extra = [];
            balls.forEach(function (b) {
                if (!b.stuck) {
                    extra.push({ x: b.x, y: b.y, vx: -b.vx, vy: b.vy, stuck: false, slowUntil: 0 });
                    extra.push({ x: b.x, y: b.y, vx: b.vx * 0.6, vy: b.vy * 1.1, stuck: false, slowUntil: 0 });
                }
            });
            balls = balls.concat(extra).slice(0, 8);
        } else if (type === 'S') {
            balls.forEach(function (b) { b.slowUntil = now + 8000; });
        } else if (type === 'L') {
            lives = Math.min(lives + 1, 6);
        }
    }

    // ---- Aktualizace ----
    function update(dt, now) {
        if (state !== 'play' && state !== 'ready') { return; }

        var dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
        paddle.w = now < paddle.widenUntil ? PADDLE_BASE * 1.6 : PADDLE_BASE;
        paddle.x += dir * PADDLE_SPEED * dt;
        paddle.x = Math.max(20, Math.min(W - 20 - paddle.w, paddle.x));

        var i, j;
        for (i = 0; i < balls.length; i++) {
            var b = balls[i];
            if (b.stuck) {
                b.x = paddle.x + paddle.w / 2;
                b.y = PADDLE_Y - BALL_R;
                continue;
            }
            var k = now < b.slowUntil ? 0.6 : 1;
            // Rozdělení na podkroky, aby míček neprošel cihlou
            var steps = 3;
            for (var s = 0; s < steps; s++) {
                b.x += b.vx * k * dt / steps;
                b.y += b.vy * k * dt / steps;
                collideBall(b);
            }
        }

        balls = balls.filter(function (b) { return b.y - BALL_R < H; });
        if (balls.length === 0) {
            lives--;
            beep(120, 0.4, 'sawtooth', 0.08);
            flash = 0.4;
            if (lives <= 0) {
                saveHi();
                state = 'gameover';
            } else {
                paddle.widenUntil = 0;
                resetBall();
                state = 'ready';
            }
            return;
        }

        for (i = powerups.length - 1; i >= 0; i--) {
            var p = powerups[i];
            p.y += 280 * dt;
            if (p.y > PADDLE_Y - 10 && p.y < PADDLE_Y + PADDLE_H + 20 &&
                p.x > paddle.x - 20 && p.x < paddle.x + paddle.w + 20) {
                applyPowerup(p.type, now);
                powerups.splice(i, 1);
            } else if (p.y > H + 40) {
                powerups.splice(i, 1);
            }
        }

        for (j = particles.length - 1; j >= 0; j--) {
            var q = particles[j];
            q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
            if (q.life <= 0) { particles.splice(j, 1); }
        }
        if (flash > 0) { flash -= dt; }

        if (bricks.length === 0) {
            level++;
            score += 500;
            saveHi();
            if (level >= LEVELS.length * 2) {
                state = 'win';
            } else {
                startLevel();
            }
        }
    }

    function collideBall(b) {
        // Stěny
        if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); beep(300, 0.03); }
        if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); beep(300, 0.03); }
        if (b.y < BALL_R + 90) { b.y = BALL_R + 90; b.vy = Math.abs(b.vy); beep(300, 0.03); }

        // Pálka
        if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y + BALL_R <= PADDLE_Y + PADDLE_H + 16 &&
            b.x >= paddle.x - BALL_R && b.x <= paddle.x + paddle.w + BALL_R) {
            var speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            var rel = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2); // -1..1
            var ang = rel * 1.05; // max ~60°
            speed = Math.min(speed * 1.01, ballSpeed() * 1.6);
            b.vx = Math.sin(ang) * speed;
            b.vy = -Math.cos(ang) * speed;
            b.y = PADDLE_Y - BALL_R;
            beep(520, 0.05, 'triangle');
        }

        // Cihly
        for (var i = 0; i < bricks.length; i++) {
            var br = bricks[i];
            if (b.x + BALL_R > br.x && b.x - BALL_R < br.x + BRICK_W &&
                b.y + BALL_R > br.y && b.y - BALL_R < br.y + BRICK_H) {
                var ox = Math.min(b.x + BALL_R - br.x, br.x + BRICK_W - (b.x - BALL_R));
                var oy = Math.min(b.y + BALL_R - br.y, br.y + BRICK_H - (b.y - BALL_R));
                if (ox < oy) { b.vx = -b.vx; } else { b.vy = -b.vy; }
                br.hp--;
                if (br.hp <= 0) {
                    score += 10 * (1 + Math.floor(level / 2));
                    burst(br.x + BRICK_W / 2, br.y + BRICK_H / 2, br.color);
                    spawnPowerup(br.x + BRICK_W / 2, br.y + BRICK_H / 2);
                    bricks.splice(i, 1);
                    beep(660 + Math.random() * 200, 0.06);
                } else {
                    beep(200, 0.06);
                }
                return;
            }
        }
    }

    // ---- Vykreslení ----
    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function text(str, x, y, size, color, align) {
        ctx.font = 'bold ' + size + 'px sans-serif';
        ctx.fillStyle = color || '#fff';
        ctx.textAlign = align || 'center';
        ctx.fillText(str, x, y);
    }

    var stars = [];
    for (var si = 0; si < 80; si++) {
        stars.push({ x: Math.random() * W, y: Math.random() * H, s: 1 + Math.random() * 2, v: 8 + Math.random() * 20 });
    }

    function draw(now) {
        var g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#0a0a28');
        g.addColorStop(1, '#1b0f3a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        stars.forEach(function (s) {
            s.y += s.v / 60;
            if (s.y > H) { s.y = 0; }
            ctx.fillRect(s.x, s.y, s.s, s.s);
        });

        if (state === 'title' || state === 'confirmExit') {
            drawTitle();
            if (state === 'confirmExit') { overlay('UKONČIT HRU?', 'OK – ukončit     Zpět – zůstat'); }
            return;
        }

        // HUD
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(0, 0, W, 90);
        text('SKÓRE ' + score, 40, 60, 40, '#fff', 'left');
        text('REKORD ' + hiScore, W / 2, 60, 40, '#ffd84d', 'center');
        text('LEVEL ' + (level + 1) + '   ŽIVOTY ' + lives, W - 40, 60, 40, '#fff', 'right');

        // Cihly
        bricks.forEach(function (br) {
            ctx.fillStyle = br.color;
            roundRect(br.x, br.y, BRICK_W, BRICK_H, 8);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(br.x + 6, br.y + 5, BRICK_W - 12, 8);
            if (br.hp > 1) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 4;
                roundRect(br.x + 2, br.y + 2, BRICK_W - 4, BRICK_H - 4, 7);
                ctx.stroke();
            }
        });

        // Pálka
        var pg = ctx.createLinearGradient(0, PADDLE_Y, 0, PADDLE_Y + PADDLE_H);
        pg.addColorStop(0, '#9ad0ff');
        pg.addColorStop(1, '#2a6cd8');
        ctx.fillStyle = pg;
        roundRect(paddle.x, PADDLE_Y, paddle.w, PADDLE_H, 13);
        ctx.fill();

        // Bonusy
        powerups.forEach(function (p) {
            var col = { W: '#4dd2ff', M: '#ffd84d', S: '#6fe06f', L: '#ff6fb5' }[p.type];
            ctx.fillStyle = col;
            roundRect(p.x - 30, p.y - 20, 60, 40, 12);
            ctx.fill();
            text(p.type, p.x, p.y + 14, 36, '#111');
        });

        // Míčky
        balls.forEach(function (b) {
            ctx.beginPath();
            ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
            ctx.fillStyle = now < b.slowUntil ? '#8fff8f' : '#fff';
            ctx.shadowColor = '#fff';
            ctx.shadowBlur = 18;
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // Částice
        particles.forEach(function (q) {
            ctx.globalAlpha = Math.max(0, q.life * 2);
            ctx.fillStyle = q.color;
            ctx.fillRect(q.x, q.y, 8, 8);
        });
        ctx.globalAlpha = 1;

        if (flash > 0) {
            ctx.fillStyle = 'rgba(255,0,0,' + (flash * 0.8) + ')';
            ctx.fillRect(0, 0, W, H);
        }

        if (state === 'ready') {
            text('Stiskněte OK pro vypuštění míčku', W / 2, H / 2 + 120, 48, '#fff');
        } else if (state === 'paused') {
            overlay('PAUZA', 'OK – pokračovat     Zpět – do menu');
        } else if (state === 'gameover') {
            overlay('KONEC HRY', 'Skóre ' + score + '     OK – nová hra     Zpět – do menu');
        } else if (state === 'win') {
            overlay('VYHRÁLI JSTE!', 'Skóre ' + score + '     OK – nová hra     Zpět – do menu');
        }
    }

    function overlay(title, sub) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, 0, W, H);
        text(title, W / 2, H / 2 - 20, 130, '#ffd84d');
        text(sub, W / 2, H / 2 + 70, 48, '#fff');
    }

    function drawTitle() {
        text('ARKANOID', W / 2, 330, 190, '#4dd2ff');
        for (var i = 0; i < 8; i++) {
            ctx.fillStyle = COLORS[i];
            roundRect(W / 2 - 4 * 130 + i * 130 + 5, 400, 120, 40, 8);
            ctx.fill();
        }
        text('REKORD ' + hiScore, W / 2, 540, 52, '#ffd84d');
        text('Stiskněte OK pro start', W / 2, 700, 64, '#fff');
        text('◀ ▶  pohyb pálky      OK  vypustit míček / pauza      Zpět  menu / konec', W / 2, 830, 40, '#aab');
        text('Bonusy:  W široká pálka   M více míčků   S zpomalení   L život', W / 2, 910, 38, '#aab');
    }

    // ---- Vstup ----
    function exitApp() {
        try {
            tizen.application.getCurrentApplication().exit();
            return;
        } catch (e) { /* mimo Tizen */ }
        // Titan OS: hostovaná webová aplikace, návrat do launcheru
        try {
            window.close();
        } catch (e) { /* ignorovat */ }
        if (window.history.length > 1) { window.history.back(); }
    }

    function onAction() {
        if (state === 'confirmExit') {
            exitApp();
            state = 'title';
        } else if (state === 'title' || state === 'gameover' || state === 'win') {
            newGame();
        } else if (state === 'ready') {
            launch();
        } else if (state === 'play') {
            state = 'paused';
        } else if (state === 'paused') {
            state = 'play';
        }
    }

    function onBack() {
        if (state === 'title') {
            state = 'confirmExit';
        } else if (state === 'confirmExit') {
            state = 'title';
        } else if (state === 'play' || state === 'ready') {
            state = 'paused';
        } else {
            saveHi();
            state = 'title';
        }
    }

    document.addEventListener('keydown', function (e) {
        var k = e.keyCode;
        if (k === KEY.LEFT) { held.left = true; }
        else if (k === KEY.RIGHT) { held.right = true; }
        else if (e.repeat) { return; }
        else if (k === KEY.ENTER || k === KEY.SPACE) { onAction(); }
        else if (k === KEY.PLAYPAUSE || k === KEY.P) {
            if (state === 'play') { state = 'paused'; } else if (state === 'paused') { state = 'play'; }
        }
        else if (BACK_KEYS.indexOf(k) !== -1) { onBack(); }
        else { return; }
        e.preventDefault();
        if (audio && audio.state === 'suspended') { try { audio.resume(); } catch (x) { /* ignorovat */ } }
    });

    document.addEventListener('keyup', function (e) {
        if (e.keyCode === KEY.LEFT) { held.left = false; }
        else if (e.keyCode === KEY.RIGHT) { held.right = false; }
    });

    // Při skrytí aplikace automaticky pauza
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && state === 'play') { state = 'paused'; }
    });

    // ---- Hlavní smyčka ----
    function frame(ts) {
        var dt = Math.min(0.05, (ts - lastTime) / 1000 || 0);
        lastTime = ts;
        update(dt, ts);
        draw(ts);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
