mod old_wix_uninstall;

pub async fn run_migrations() {
    old_wix_uninstall::run().await;
}
