use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Runtime,
};

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();
    let about_meta = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        authors: Some(vec!["Matheus Monteiro".into()]),
        license: Some("MIT".into()),
        website: Some("https://termlab.matheusmonteiro.me".into()),
        website_label: Some("termlab.matheusmonteiro.me".into()),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        "Term Lab",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("Sobre o Term Lab"), Some(about_meta))?,
            &MenuItem::with_id(app, "check-updates", "Verificar Atualizações…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "preferences", "Preferências…", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("Serviços"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Ocultar Term Lab"))?,
            &PredefinedMenuItem::hide_others(app, Some("Ocultar Outros"))?,
            &PredefinedMenuItem::show_all(app, Some("Mostrar Tudo"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Sair do Term Lab"))?,
        ],
    )?;

    let shell_menu = Submenu::with_items(
        app,
        "Shell",
        true,
        &[
            &MenuItem::with_id(app, "new-tab", "Nova Aba", true, Some("CmdOrCtrl+T"))?,
            &MenuItem::with_id(app, "split-right", "Dividir ao Lado", true, Some("CmdOrCtrl+D"))?,
            &MenuItem::with_id(app, "split-down", "Dividir Abaixo", true, Some("CmdOrCtrl+Shift+D"))?,
            &MenuItem::with_id(app, "rename-tab", "Renomear Aba…", true, Some("CmdOrCtrl+Shift+R"))?,
            &MenuItem::with_id(app, "save-group", "Salvar Grupo…", true, Some("CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close-pane", "Fechar Painel", true, Some("CmdOrCtrl+W"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Editar",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Desfazer"))?,
            &PredefinedMenuItem::redo(app, Some("Refazer"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Recortar"))?,
            &PredefinedMenuItem::copy(app, Some("Copiar"))?,
            &PredefinedMenuItem::paste(app, Some("Colar"))?,
            &PredefinedMenuItem::select_all(app, Some("Selecionar Tudo"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "find", "Buscar…", true, Some("CmdOrCtrl+F"))?,
            &MenuItem::with_id(app, "clear", "Limpar Terminal", true, Some("CmdOrCtrl+K"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "Visualizar",
        true,
        &[
            &MenuItem::with_id(app, "zoom-in", "Aumentar Fonte", true, Some("CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "zoom-out", "Diminuir Fonte", true, Some("CmdOrCtrl+-"))?,
            &MenuItem::with_id(app, "zoom-reset", "Tamanho Padrão", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("Tela Cheia"))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Janela",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimizar"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Fechar Janela"))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &shell_menu, &edit_menu, &view_menu, &window_menu])
}
