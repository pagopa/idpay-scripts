	function userDeonboarding(userId, dry = false){
		print("userDeonboarding userId: " + userId);
		let onboardingCitizen = db.getSiblingDB("idpay-beneficiari")["onboarding_citizen"].findOne({ userId: userId });
		if (onboardingCitizen) {
			print("✓ onboarding_citizen found:");
			printjson(onboardingCitizen);
		}else{
			print("✗ onboarding_citizen not found:");
			return 1;
		}
		let familyId = onboardingCitizen.familyId;
		if(!familyId){
			print("✗ familyId not valid.");
			familyId = userId;
		}

		let initiativeId = "68dd003ccce8c534d1da22bc";

		deleteAll("idpay-beneficiari", "hpan_initiatives_lookup", { userId: userId }, dry);
		deleteAll("idpay-beneficiari", "initiative_counters", { userId: userId, initiativeId: initiativeId }, dry);
		decrementInitiativeCounter(initiativeId, dry)
		deleteAll("idpay-beneficiari", "onboarding_citizen", { userId: userId }, dry);
		// TOCHECK: I REMOVE THE WHOLE FAMILY !!!
		deleteAll("idpay-beneficiari", "onboarding_families", { memberIds: userId }, dry);
		deleteAll("idpay-beneficiari", "payment_instrument", { userId: userId }, dry);
		deleteAll("idpay-beneficiari", "timeline", { userId: userId }, dry);
		deleteAll("idpay-pagamenti", "transaction", { userId: userId }, dry);
		deleteAll("idpay-beneficiari", "transaction_in_progress", { userId: userId }, dry);
		deleteAll("idpay-pagamenti", "user_initiative_counters", { entityId: userId }, dry);
		deleteAll("idpay-pagamenti", "user_initiative_counters", { entityId: familyId }, dry);
		deleteAll("idpay-beneficiari", "wallet", { userId: userId }, dry);
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
			let query = { _id: ObjectId( initiativeId ) }
			let updateResult = db.getSiblingDB("idpay-beneficiari")["initiative_counters"].updateMany(query, update);
			print("initiative_counters - Decremented onboarded counter by 1");
		}
	}

	function cfDeboarding(userFiscalCode, dry = false){
		let clearDataVault = db.getSiblingDB("idpay-beneficiari")["data_vault"].findOne({ data: userFiscalCode });
		if (clearDataVault) {
			print("✓ data_vault found:");
			printjson(clearDataVault);
		}else{
			print("✗ data_vault not found:");
			return 1;
		}
		let userId = clearDataVault._id.toString();
		userDeonboarding(userId, dry);
	}

	function bulkuserDeonboarding(dry = false) {
		let allUsers = db.getSiblingDB("idpay-beneficiari")["onboarding_citizen"].find({}, { userId: 1, _id: 0 });
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
			userDeonboarding(userId, dry);
		});
	}

	// version : 2026-05-26 v1

	//bulkuserDeonboarding(true);
	//userDeonboarding("890eYgVnEHteaywo0yfq9lzuv", false);
	//cfDeboarding("LLLLNZ80A01F205O", false); // l.lollo    dev:ee46mQR0pYxRmHrkJOhETC2wd uat:ee46bbyKPElSp98PtEBZ24EnQ
	//cfDeboarding("DRGVNI78L14C573A", false); // i.drago    dev:7bb1kI97lLK39thlEvw5WaVyU uat:
	//cfDeboarding("CRCCRL77A19G273Q", false); // c.cracco   dev:2d445aDsx6ebPKJLuK4FV9RxA uat:
	//cfDeboarding("CLVTLI80A01F839V", false); // i.calvino  uat:890eYgVnEHteaywo0yfq9lzuv uat:
	//cfDeboarding("CRUMRA76S58A944V", false); // m.curie    dev:d7f7P0sCxD4cptx1BaQWlmy1l uat:
