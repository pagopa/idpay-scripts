	function userDeonboarding(initiativeId, userId, dry = false){
		print("userDeonboarding userId: " + userId);
		let query = { userId: userId, initiativeId: initiativeId };
		let onboardingCitizen = db.getSiblingDB("idpay-beneficiari")["onboarding_citizen"].findOne(query);
		if (onboardingCitizen) {
			print("✓ onboarding_citizen found:");
			printjson(onboardingCitizen);
		}else{
			print("✗ onboarding_citizen not found:");
			return 1;
		}
		let familyId = onboardingCitizen.familyId;
		if(!familyId){
			print("✗ familyId not valid, using userId as familyId.");
			familyId = userId;
		}

        let userInitiativeQuery = { userId: userId, initiativeId: initiativeId };

		deleteAll("idpay-beneficiari", "initiative_counters", userInitiativeQuery, dry);
		decrementInitiativeCounter(initiativeId, dry);
		deleteAll("idpay-beneficiari", "onboarding_citizen", userInitiativeQuery, dry);
		deleteAll("idpay-beneficiari", "onboarding_families", { memberIds: userId }, dry);
		deleteAll("idpay-beneficiari", "payment_instrument", userInitiativeQuery, dry);
		deleteAll("idpay-beneficiari", "timeline", userInitiativeQuery, dry);
		deleteAll("idpay-pagamenti", "user_initiative_counters", { entityId: userId, initiativeId: initiativeId }, dry);
		deleteAll("idpay-pagamenti", "user_initiative_counters", { entityId: familyId, initiativeId: initiativeId }, dry);
		deleteAll("idpay-beneficiari", "wallet", userInitiativeQuery, dry);

		printPostgresTransactionDeleteWarning(userId, initiativeId);
	}

	function printPostgresTransactionDeleteWarning(userId, initiativeId){
		print("");
		print("⚠️  ATTENZIONE: ricordati di cancellare i dati su PostgreSQL, incolla lo scriot, evidenzialo e premi CTRL+ENTER per eseguirlo:");
		print("-- userId: " + userId + " | initiativeId: " + initiativeId);
		print("");
		print("");
		print("BEGIN;");
		print("");
		print("CREATE TEMP TABLE tmp_deleted_tx_ids ON COMMIT DROP AS");
		print("SELECT id");
		print("FROM \"idpay-pagamenti\".transaction");
		print("WHERE \"userId\" = '" + userId + "'");
		print("  AND \"initiativeId\" = '" + initiativeId + "';");
		print("");
		print("DELETE FROM \"idpay-pagamenti\".transaction");
		print("WHERE id IN (SELECT id FROM tmp_deleted_tx_ids);");
		print("");
		print("DELETE FROM \"idpay-pagamenti\".transaction_outbox");
		print("WHERE transaction_id IN (SELECT id FROM tmp_deleted_tx_ids);");
		print("");
		print("DELETE FROM \"idpay-rimborsi\".reward_transactions");
		print("WHERE transaction_id IN (SELECT id FROM tmp_deleted_tx_ids);");
		print("");
		print("COMMIT;");
	}

	function deleteAll(databaseName, collectionName, query, dry){
		let result = db.getSiblingDB(databaseName)[collectionName].find(query);
		print(databaseName + "." + collectionName + " - Deleting: " + result.count() + (dry ? " DRY":""));
		printjson(result);
		if(!dry){
			let deleteResult = db.getSiblingDB(databaseName)[collectionName].deleteMany(query);
			print(databaseName + "." + collectionName + " - Deleted rows: " + deleteResult.deletedCount);
		}
	}

	function decrementInitiativeCounter(initiativeId, dry){
		if(dry){
			print("initiative_counters - Would decrement onboarded - DRY");
		}else{
			let update = {
				$inc: { onboarded: -1 }
			};
			let query = { _id: ObjectId( initiativeId ) };
			let updateResult = db.getSiblingDB("idpay-beneficiari")["initiative_counters"].updateMany(query, update);
			print("initiative_counters - Decremented onboarded counter by 1");
		}
	}

	function cfDeboarding(initiativeId, userFiscalCode, dry = false){
		let clearDataVault = db.getSiblingDB("idpay-beneficiari")["data_vault"].findOne({ data: userFiscalCode });
		if (clearDataVault) {
			print("✓ data_vault found:");
			printjson(clearDataVault);
		}else{
			print("✗ data_vault not found:");
			return 1;
		}
		let userId = clearDataVault._id.toString();
		userDeonboarding(initiativeId, userId, dry);
	}

	function bulkuserDeonboarding(initiativeId, dry = false) {
	    let query = { initiativeId: initiativeId };
	    let projection = { userId: 1, _id: 0 };
		let allUsers = db.getSiblingDB("idpay-beneficiari")["onboarding_citizen"].find(query, projection);
		let userIds = [];

		allUsers.forEach(function(doc) {
			if (doc.userId) {
				userIds.push(doc.userId);
			}
		});

		if (userIds.length === 0) {
			print("No users found. Exiting.");
			return 0;
		}

		print("⚠️  WARNING: This will delete " + userIds.length + " users and all their data!");

		userIds.forEach(function(userId, index) {
			userDeonboarding(initiativeId, userId, dry);
		});
	}

	// version : 2026-06-08 v1
    //let initiativeId = "68dd003ccce8c534d1da22bc"; // bonus elettrodomestici 2025
    let initiativeId = "69e0fa95e21efa516c7b8dec"; // bonus decoder 2026

	//bulkuserDeonboarding(initiativeId, true);
	//userDeonboarding(initiativeId, "890eYgVnEHteaywo0yfq9lzuv", false);
	//cfDeboarding(initiativeId, "LLLLNZ80A01F205O", false); // l.lollo    dev:ee46mQR0pYxRmHrkJOhETC2wd uat:ee46bbyKPElSp98PtEBZ24EnQ
	//cfDeboarding(initiativeId, "DRGVNI78L14C573A", true); // i.drago    dev:7bb1kI97lLK39thlEvw5WaVyU uat:
	//cfDeboarding(initiativeId, "CRCCRL77A19G273Q", true); // c.cracco   dev:2d445aDsx6ebPKJLuK4FV9RxA uat:
	//cfDeboarding(initiativeId, "CLVTLI80A01F839V", false); // i.calvino  uat:890eYgVnEHteaywo0yfq9lzuv uat:
	cfDeboarding(initiativeId, "CRUMRA76S58A944V", false); // m.curie    dev:d7f7P0sCxD4cptx1BaQWlmy1l uat:
