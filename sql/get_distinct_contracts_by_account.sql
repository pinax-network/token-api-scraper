SELECT DISTINCT log_address
FROM erc20_transfer_agg
WHERE account = {account:String}