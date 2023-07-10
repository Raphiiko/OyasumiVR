<script>
  import "../app.scss";
</script>

<slot />

<style lang="scss">
	:global(:root) {
		--color-vrchat-status-blue: #409eff;
		--color-vrchat-status-green: #67c23a;
		--color-vrchat-status-orange: #fd9200;
		--color-vrchat-status-red: #f56c6c;
	}
</style>
